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

describe('freshness-forward hot feed ranking', () => {
  test('leads with a recent post while keeping an excellent old conversation next', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5')`)
    post(1, 1, '2024-01-01 12:00:00')
    for (let id = 2; id <= 5; id++) post(id, id, '2024-01-02 12:00:00', 1)
    post(1, 10, '2026-08-03 10:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)

    expect(getHotPosts(database, 20, null, asOf).map(result => result.id)).toEqual([10, 1])
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

  test('degrades an older conversation without erasing its engagement', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2')`)
    post(1, 1, '2025-01-01 12:00:00')
    post(2, 2, '2025-01-02 12:00:00', 1)
    post(1, 10, '2026-08-03 10:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([10, 1])
    expect(results[1].hot_score).toBeLessThan(results[0].hot_score * 0.7)
    expect(results[1].hot_score).toBeGreaterThan(results[0].hot_score * 0.1)
  })

  test('promotes a newer conversation that quickly attracts several replies', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5'),(6,'r6'),(7,'r7')`)
    post(1, 1, '2026-07-04 09:00:00')
    for (let id = 2; id <= 7; id++) post(id, id, '2026-07-05 09:00:00', 1)

    post(1, 10, '2026-08-03 08:00:00')
    post(2, 11, '2026-08-03 09:00:00', 10)
    post(3, 12, '2026-08-03 10:00:00', 10)
    post(4, 13, '2026-08-03 11:00:00', 10)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([10, 1])
    expect(results[0].reply_count).toBe(3)
    expect(results[0].hot_score).toBeGreaterThan(results[1].hot_score * 1.5)
  })

  test('rewards several replies arriving in a compact burst', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5'),(6,'r6'),(7,'r7')`)
    post(1, 1, '2026-08-02 08:00:00')
    post(2, 2, '2026-08-02 16:00:00', 1)
    post(3, 3, '2026-08-03 00:00:00', 1)
    post(4, 4, '2026-08-03 08:00:00', 1)

    post(1, 10, '2026-08-02 08:00:00')
    post(5, 11, '2026-08-02 09:00:00', 10)
    post(6, 12, '2026-08-02 10:00:00', 10)
    post(7, 13, '2026-08-02 11:00:00', 10)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([10, 1])
    expect(results[0].hot_score).toBeGreaterThan(results[1].hot_score)
  })

  test('lets a highly discussed older post leak in above routine recent activity', () => {
    database.run(`INSERT INTO users(id,handle) VALUES
      (2,'r2'),(3,'r3'),(4,'r4'),(5,'r5'),(6,'r6'),(7,'r7'),(8,'r8'),(9,'r9')`)
    post(1, 1, '2026-07-04 09:00:00')
    for (let id = 2; id <= 9; id++) post(id, id, '2026-07-05 09:00:00', 1)

    post(1, 10, '2026-08-03 08:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)
    post(1, 20, '2026-08-03 08:00:00')
    post(2, 21, '2026-08-03 11:00:00', 20)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([20, 10, 1])
    expect(results[2].reply_count).toBe(8)
    expect(results[2].hot_score).toBeGreaterThan(20)
  })

  test('brings several recent conversations up without removing strong old posts', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5')`)
    post(1, 1, '2026-07-01 12:00:00')
    for (let id = 2; id <= 5; id++) post(id, id, '2026-07-02 12:00:00', 1)
    for (const rootId of [10, 20, 30]) {
      post(1, rootId, '2026-08-02 12:00:00')
      post(2, rootId + 1, '2026-08-03 10:00:00', rootId)
    }

    const ids = getHotPosts(database, 20, null, asOf).map(result => result.id)
    expect(ids.slice(0, 3).every(id => [10, 20, 30].includes(id))).toBeTrue()
    expect(ids).toContain(1)
  })

  test('penalizes posts containing meta and each of its aliases', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5')`)
    for (const [id, tag] of [[10, null], [20, 'meta'], [30, 'tlog'], [40, 'textlog']] as const) {
      post(1, id, '2026-08-03 10:00:00')
      post(2, id + 1, '2026-08-03 11:00:00', id)
      if (tag) database.query('INSERT INTO post_hashtags VALUES(?,?)').run(id, tag)
    }

    const results = getHotPosts(database, 20, null, asOf)
    const ordinaryScore = results.find(result => result.id === 10)!.hot_score
    expect(results.map(result => result.id)).toEqual([10, 40, 30, 20])
    for (const id of [20, 30, 40]) {
      expect(results.find(result => result.id === id)!.hot_score).toBeCloseTo((ordinaryScore - 1) * 0.5)
    }
  })

  test('requires independent engagement and ignores author-only replies', () => {
    post(1, 1, '2026-08-03 10:00:00')
    post(1, 2, '2026-08-03 11:00:00', 1)
    expect(getHotPosts(database, 20, null, asOf)).toEqual([])
  })

  test('strongly discounts old poll participation', () => {
    post(1, 1, '2024-01-01 12:00:00')
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2')`)
    post(1, 10, '2026-08-03 10:00:00')
    post(2, 11, '2026-08-03 11:00:00', 10)
    database.run(`CREATE TABLE poll_votes (post_id INTEGER NOT NULL,option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id))`)
    for (let userId = 2; userId <= 8; userId++) {
      database.query('INSERT INTO poll_votes VALUES(1,1,?,?)').run(userId, '2024-01-02 12:00:00')
    }
    recordHotActivity(database, 1)
    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([10, 1])
    expect(results[1].hot_score).toBeLessThan(results[0].hot_score * 0.1)
  })

  test('ranks the newer active poll 2737 far above stale high-vote poll 2326', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'),(3,'r3'),(4,'r4'),(5,'r5'),(6,'r6');
      CREATE TABLE poll_votes (post_id INTEGER NOT NULL,option_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id));`)
    post(1, 2326, '2026-08-24 22:57:10')
    post(1, 2737, '2026-08-28 09:47:07')
    for (let userId = 2; userId <= 6; userId++) {
      post(userId, 2400 + userId, '2026-08-26 03:16:28', 2326)
      post(userId, 2740 + userId, '2026-08-28 13:25:09', 2737)
    }
    for (let userId = 10; userId < 64; userId++) {
      database.query('INSERT INTO poll_votes VALUES(2326,1,?,?)').run(userId, '2026-08-25 22:51:45')
    }
    for (let userId = 70; userId < 78; userId++) {
      database.query('INSERT INTO poll_votes VALUES(2737,1,?,?)').run(userId, '2026-08-28 12:57:26')
    }
    recordHotActivity(database, 2326)
    recordHotActivity(database, 2737)

    const results = getHotPosts(database, 20, null, '2026-08-28T14:00:00.000Z')
    const oldPoll = results.find(result => result.id === 2326)!
    const newPoll = results.find(result => result.id === 2737)!
    expect(results.map(result => result.id)).toEqual([2737, 2326])
    expect(oldPoll.hot_score).toBeLessThan(newPoll.hot_score * 0.5)
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
