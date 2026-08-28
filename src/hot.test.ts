import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { getHotPosts, hotCursor, rebuildHotPosts, recordHotActivity } from './hot'

const asOf = '2026-08-03T12:00:00.000Z'
let database: Database

beforeEach(() => {
  database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,account_group_id INTEGER);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL,blocked_id INTEGER NOT NULL);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,activity_count INTEGER NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
    INSERT INTO users(id,handle) VALUES(1,'author');
  `)
})

function post(userId: number, id: number, createdAt: string, parentId: number | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,NULL)').run(id, userId, parentId, `post ${id}`, createdAt)
  database.query('INSERT INTO post_hot VALUES(?,0,0,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
}

describe('quality-first hot feed ranking', () => {
  test('puts an excellent old conversation ahead of a modest fresh one', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5')`)
    post(1, 1, '2024-01-01 12:00:00')
    for (let id = 2; id <= 5; id++) post(id, id, '2024-01-02 12:00:00', 1)
    post(1, 10, '2026-08-03 10:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)

    expect(getHotPosts(database, 20, null, asOf).map(result => result.id)).toEqual([1, 10])
  })

  test('returns conversation roots instead of promoting replies', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3')`)
    post(1, 1, '2026-07-01 12:00:00')
    post(2, 2, '2026-08-03 10:00:00', 1)
    post(3, 3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1])
    expect(results[0].reply_count).toBe(2)
  })

  test('uses freshness only as a small tie-breaker for equal quality', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2')`)
    post(1, 1, '2025-01-01 12:00:00')
    post(2, 2, '2025-01-02 12:00:00', 1)
    post(1, 10, '2026-08-03 10:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)

    expect(getHotPosts(database, 20, null, asOf).map(result => result.id)).toEqual([10, 1])
  })

  test('requires independent engagement and ignores author-only replies', () => {
    post(1, 1, '2026-08-03 10:00:00')
    post(1, 2, '2026-08-03 11:00:00', 1)
    expect(getHotPosts(database, 20, null, asOf)).toEqual([])
  })

  test('counts durable poll participation as quality', () => {
    post(1, 1, '2024-01-01 12:00:00')
    database.run(`CREATE TABLE poll_votes (post_id INTEGER NOT NULL,option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id))`)
    for (let userId = 2; userId <= 8; userId++) {
      database.query('INSERT INTO poll_votes VALUES(1,1,?,?)').run(userId, '2024-01-02 12:00:00')
    }
    recordHotActivity(database, 1)
    expect(getHotPosts(database, 20, null, asOf, -1, false, 2).map(result => result.id)).toEqual([1])
  })

  test('keeps cursor pagination deterministic', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2')`)
    for (const id of [1, 10, 20]) {
      post(1, id, '2026-08-01 12:00:00')
      post(2, id + 1, '2026-08-02 12:00:00', id)
    }
    const first = getHotPosts(database, 2, null, asOf)
    const second = getHotPosts(database, 2, hotCursor(first[1], asOf))
    expect(first.map(result => result.id)).toEqual([20, 10])
    expect(second.map(result => result.id)).toEqual([1])
  })

  test('incremental and full engagement rebuilds produce the same rank', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3')`)
    post(1, 1, '2025-01-01 12:00:00')
    post(2, 2, '2025-01-02 12:00:00', 1)
    post(3, 3, '2025-01-03 12:00:00', 1)
    const incremental = getHotPosts(database, 20, null, asOf).map(result => [result.id, result.hot_score])
    rebuildHotPosts(database)
    expect(getHotPosts(database, 20, null, asOf).map(result => [result.id, result.hot_score])).toEqual(incremental)
  })
})
