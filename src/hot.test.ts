import { beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { getHotPosts, hotCursor, recordHotActivity, removeHotActivity } from './hot'

const asOf = '2026-08-03T12:00:00.000Z'
let database: Database

beforeEach(() => {
  database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL);
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL);
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
  `)
  database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(1, 'tester')
})

function post(id: number, createdAt: string, parentId: number | null = null, deletedAt: string | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, 1, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
  if (deletedAt) {
    database.query('UPDATE posts SET deleted_at=? WHERE id=?').run(deletedAt, id)
    removeHotActivity(database, id)
  }
}

describe('hot feed ranking', () => {
  test('decays standalone post activity with a 24-hour half-life', () => {
    post(1, '2026-08-03 12:00:00')
    post(2, '2026-08-02 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 2])
    expect(results[0].hot_score).toBeCloseTo(1)
    expect(results[1].hot_score).toBeCloseTo(0.5)
  })

  test('direct and nested replies boost each ancestor while ranking independently', () => {
    post(1, '2026-07-30 12:00:00')
    post(2, '2026-08-03 10:00:00', 1)
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 2, 3])
    expect(results[0].hot_score).toBeGreaterThan(results[1].hot_score)
    expect(results[1].hot_score).toBeGreaterThan(results[2].hot_score)
    expect(results[0].latest_activity_at).toBe('2026-08-03 11:00:00')
  })

  test('excludes deleted posts and events but traverses through a deleted intermediary', () => {
    post(1, '2026-07-30 12:00:00')
    post(2, '2026-08-03 10:00:00', 1, '2026-08-03 10:30:00')
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 3])
    expect(results[0].latest_activity_at).toBe('2026-08-03 11:00:00')
    expect(results[0].hot_score).toBeCloseTo(results[1].hot_score + 0.0625)
  })

  test('uses deterministic tie-breakers and pagination', () => {
    post(1, '2026-08-03 11:00:00')
    post(2, '2026-08-03 11:00:00')
    post(3, '2026-08-03 10:00:00')

    const first = getHotPosts(database, 2, null, asOf)
    expect(first.map(result => result.id)).toEqual([2, 1])
    const second = getHotPosts(database, 2, hotCursor(first[1], asOf), asOf)
    expect(second.map(result => result.id)).toEqual([3])
    expect(getHotPosts(database, 2, hotCursor(second[0], asOf, 'previous'), asOf)
      .map(result => result.id)).toEqual([2, 1])
  })

  test('hides posts when either user has blocked the other', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'blocked')
    post(1, '2026-08-03 11:00:00')
    database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
      .run(2, 2, null, 'hidden', '2026-08-03 12:00:00', null)
    database.query('INSERT INTO post_hot VALUES(?,0,?,?)')
      .run(2, '2026-08-03 12:00:00', '2026-08-03 12:00:00')
    recordHotActivity(database, 2)
    database.query('INSERT INTO blocks VALUES(?,?)').run(2, 1)

    const results = getHotPosts(database, 20, null, asOf, 1)
    expect(results.map(result => result.id)).toEqual([1])
    expect(results[0].hot_score).toBeCloseTo(Math.pow(0.5, 1 / 24))
  })
})
