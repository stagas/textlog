import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { insertRateLimitedPost, postRateLimitMessage } from './post-rate-limit'

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
  test('allows three posts, then rejects another post from the same account', () => {
    expect(insertRateLimitedPost(database, 1, 'one')).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'two', 10)).toHaveProperty('id')
    expect(insertRateLimitedPost(database, 1, 'three')).toHaveProperty('id')

    const result = insertRateLimitedPost(database, 1, 'four')
    expect(result).toHaveProperty('retryAfter')
    expect(database.query('SELECT count(*) count FROM posts WHERE user_id=1').get()).toEqual({ count: 3 })
  })

  test('does not share limits between accounts', () => {
    for (let i = 0; i < 3; i++) insertRateLimitedPost(database, 1, `post ${i}`)
    expect(insertRateLimitedPost(database, 2, 'another account')).toHaveProperty('id')
  })

  test('allows posting after the rolling window has passed', () => {
    database.run("INSERT INTO posts(user_id,body,created_at) VALUES(1,'old',datetime('now','-6 minutes'))")
    expect(insertRateLimitedPost(database, 1, 'new')).toHaveProperty('id')
  })

  test('shows a useful retry message', () => {
    expect(postRateLimitMessage(61)).toContain('about 2 minutes')
  })
})
