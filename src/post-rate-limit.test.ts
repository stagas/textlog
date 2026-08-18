import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { DUPLICATE_POST_WINDOW_SECONDS, insertRateLimitedPost, postRateLimitMessage } from './post-rate-limit'

let database: Database

beforeEach(() => {
  database = new Database(':memory:')
  database.run(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )
  `)
})

describe('post rate limit', () => {
  test('allows five posts, then rejects another post from the same account', () => {
    expect(insertRateLimitedPost(database, 1, 'one')).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'two', 10)).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'three')).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'four')).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'five')).toHaveProperty('id')

    const result = insertRateLimitedPost(database, 1, 'six')
    expect(result).toHaveProperty('retryAfter')
    expect(database.query('SELECT count(*) count FROM posts WHERE user_id=1').get()).toEqual({ count: 5 })
  })

  test('does not share limits between accounts', () => {
    for (let i = 0; i < 5; i++) insertRateLimitedPost(database, 1, `post ${i}`)
    expect(insertRateLimitedPost(database, 2, 'another account')).toHaveProperty('id')
  })

  test('allows posting after the rolling window has passed', () => {
    database.run('INSERT INTO posts(user_id,body,created_at) VALUES(1,\'old\',datetime(\'now\',\'-6 minutes\'))')
    expect(insertRateLimitedPost(database, 1, 'new')).toHaveProperty('id')
  })

  test('reuses an identical recent post instead of inserting it again', () => {
    let insertCallbacks = 0
    const first = insertRateLimitedPost(database, 1, 'same post', null, () => insertCallbacks++)
    const duplicate = insertRateLimitedPost(database, 1, 'same post', null, () => insertCallbacks++)

    expect(first).toMatchObject({ duplicate: false })
    expect(duplicate).toEqual({ id: 'id' in first ? first.id : -1, duplicate: true })
    expect(insertCallbacks).toBe(1)
    expect(database.query('SELECT count(*) count FROM posts').get()).toEqual({ count: 1 })
  })

  test('only deduplicates posts with the same author and parent', () => {
    expect(insertRateLimitedPost(database, 1, 'same body', 10)).toMatchObject({ duplicate: false })
    expect(insertRateLimitedPost(database, 1, 'same body', 11)).toMatchObject({ duplicate: false })
    expect(insertRateLimitedPost(database, 2, 'same body', 10)).toMatchObject({ duplicate: false })
  })

  test('allows identical content after the duplicate window', () => {
    database.query(`INSERT INTO posts(user_id,body,created_at) VALUES(1,?,datetime('now', '-' || ? || ' seconds'))`)
      .run('repeat later', DUPLICATE_POST_WINDOW_SECONDS + 1)

    expect(insertRateLimitedPost(database, 1, 'repeat later')).toMatchObject({ duplicate: false })
  })

  test('shows a useful retry message', () => {
    expect(postRateLimitMessage(61)).toContain('about 2 minutes')
  })
})
