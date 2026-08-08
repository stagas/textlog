import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { getHotPosts, hotCursor, rebuildHotPosts, recordHotActivity, removeHotActivity } from './hot'

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
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL,tag TEXT NOT NULL);
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

function postBy(userId: number, id: number, createdAt: string, parentId: number | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, userId, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
}

describe('hot feed ranking', () => {
  test('applies a steep 2-hour exponential penalty to age', () => {
    post(1, '2026-08-03 12:00:00')
    post(2, '2026-08-02 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 2])
    expect(results[0].hot_score).toBeCloseTo(1)
    expect(results[1].hot_score).toBeCloseTo(Math.pow(0.5, 12))
  })

  test('surfaces a new event above a busier thread from yesterday', () => {
    post(1, '2026-08-02 12:00:00')
    post(2, '2026-08-02 12:00:00', 1)
    post(3, '2026-08-02 12:00:00', 1)
    post(4, '2026-08-03 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(4)
    expect(results.find(result => result.id === 1)?.hot_score).toBeCloseTo(9 * Math.pow(0.5, 12))
  })

  test('direct replies give active threads substantially more staying power', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-08-03 04:00:00')
    postBy(2, 2, '2026-08-03 06:00:00', 1)
    postBy(2, 3, '2026-08-03 06:00:00', 1)
    postBy(2, 4, '2026-08-03 06:00:00', 1)
    postBy(2, 5, '2026-08-03 06:00:00', 1)
    post(6, '2026-08-03 11:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results[0].hot_score).toBeGreaterThan(1)

    rebuildHotPosts(database)
    expect(getHotPosts(database, 20, null, asOf)[0].id).toBe(1)
  })

  test('nested reply boosts halve at each level', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-08-03 12:00:00')
    postBy(2, 2, '2026-08-03 12:00:00', 1)
    postBy(2, 3, '2026-08-03 12:00:00', 2)
    postBy(2, 4, '2026-08-03 12:00:00', 3)

    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(1 + 4 + 2 + 1)

    rebuildHotPosts(database)
    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(1 + 4 + 2 + 1)
  })

  test('deleting a nested reply removes its branch credit from every ancestor', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-08-03 12:00:00')
    postBy(2, 2, '2026-08-03 12:00:00', 1)
    postBy(2, 3, '2026-08-03 12:00:00', 2)
    postBy(2, 4, '2026-08-03 12:00:00', 3)
    database.query('UPDATE posts SET deleted_at=? WHERE id=?').run('2026-08-03 12:00:00', 2)
    removeHotActivity(database, 2)

    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(1)
  })

  test('direct replies boost a post most while nested replies also rank independently', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-07-30 12:00:00')
    postBy(2, 2, '2026-08-03 10:00:00', 1)
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([2, 1, 3])
    expect(results[0].hot_score).toBeGreaterThan(results[1].hot_score)
    expect(results.find(result => result.id === 1)?.latest_activity_at).toBe('2026-08-03 10:00:00')

    rebuildHotPosts(database)
    const rebuilt = getHotPosts(database, 20, null, asOf)
    expect(rebuilt.map(result => result.id)).toEqual([2, 1, 3])
    expect(rebuilt.find(result => result.id === 1)?.latest_activity_at).toBe('2026-08-03 10:00:00')
  })

  test('does not let authors boost their own posts with direct replies', () => {
    post(1, '2026-08-03 08:00:00')
    post(2, '2026-08-03 11:00:00', 1)

    let root = getHotPosts(database, 20, null, asOf).find(result => result.id === 1)!
    expect(root.latest_activity_at).toBe('2026-08-03 08:00:00')
    expect(root.hot_score).toBeCloseTo(Math.pow(0.5, 2))

    database.query(`UPDATE post_hot SET score=99,score_updated_at='2026-08-03 11:00:00',
      latest_activity_at='2026-08-03 11:00:00' WHERE post_id=1`).run()
    rebuildHotPosts(database)
    root = getHotPosts(database, 20, null, asOf).find(result => result.id === 1)!
    expect(root.latest_activity_at).toBe('2026-08-03 08:00:00')
    expect(root.hot_score).toBeCloseTo(Math.pow(0.5, 2))
  })

  test('excludes deleted direct replies without promoting their nested replies', () => {
    post(1, '2026-07-30 12:00:00')
    post(2, '2026-08-03 10:00:00', 1, '2026-08-03 10:30:00')
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([3, 1])
    expect(results[1].latest_activity_at).toBe('2026-07-30 12:00:00')
    expect(results[1].hot_score).toBeCloseTo(Math.pow(0.5, 48))
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
    expect(results[0].hot_score).toBeCloseTo(Math.pow(0.5, 1 / 2))
  })

  test('hides every post carrying a blocked hashtag', () => {
    post(1, '2026-08-03 11:00:00')
    post(2, '2026-08-03 12:00:00')
    database.run(`INSERT INTO post_hashtags VALUES(2,'spoilers');
      INSERT INTO blocked_hashtags VALUES(1,'spoilers');`)

    expect(getHotPosts(database, 20, null, asOf, 1).map(result => result.id)).toEqual([1])
  })
})
