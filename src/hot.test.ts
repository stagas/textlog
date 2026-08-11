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
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,reply_count INTEGER NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
  `)
  database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(1, 'tester')
})

function post(id: number, createdAt: string, parentId: number | null = null, deletedAt: string | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, 1, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
  if (deletedAt) {
    database.query('UPDATE posts SET deleted_at=? WHERE id=?').run(deletedAt, id)
    removeHotActivity(database, id)
  }
}

function postBy(userId: number, id: number, createdAt: string, parentId: number | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, userId, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
}

describe('hot feed ranking', () => {
  test('gives reply-free posts only a short, modest freshness boost', () => {
    post(1, '2026-08-03 12:00:00')
    post(2, '2026-08-02 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 2])
    expect(results[0].hot_score).toBeCloseTo(0.25)
    expect(results[1].hot_score).toBeCloseTo(0.25 * Math.pow(0.5, 4))
  })

  test('lets a busy thread from yesterday outrank a new post', () => {
    database.run('INSERT INTO users VALUES(2,\'replier\'); INSERT INTO users VALUES(3,\'another\');')
    post(1, '2026-08-02 12:00:00')
    postBy(2, 2, '2026-08-02 12:00:00', 1)
    postBy(3, 3, '2026-08-02 12:00:00', 1)
    post(4, '2026-08-03 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results.find(result => result.id === 1)?.hot_score)
      .toBeCloseTo(4.25 * Math.pow(0.5, 24 / 24))
  })

  test('direct replies give active threads substantially more staying power', () => {
    database.run(`INSERT INTO users VALUES(2,'r2'); INSERT INTO users VALUES(3,'r3');
      INSERT INTO users VALUES(4,'r4'); INSERT INTO users VALUES(5,'r5');`)
    post(1, '2026-08-03 04:00:00')
    postBy(2, 2, '2026-08-03 06:00:00', 1)
    postBy(3, 3, '2026-08-03 06:00:00', 1)
    postBy(4, 4, '2026-08-03 06:00:00', 1)
    postBy(5, 5, '2026-08-03 06:00:00', 1)
    post(6, '2026-08-03 11:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results[0].hot_score).toBeGreaterThan(1)

    rebuildHotPosts(database)
    expect(getHotPosts(database, 20, null, asOf)[0].id).toBe(1)
  })

  test('each distinct replier doubles the recency half-life up to the cap', () => {
    for (const [rootId, replies] of [[1, 1], [100, 5], [200, 20]] as const) {
      post(rootId, '2026-08-01 20:00:00')
      for (let index = 1; index <= replies; index++) {
        postBy(1_000 + rootId + index, rootId + index, '2026-08-01 20:00:00', rootId)
      }
    }

    const results = getHotPosts(database, 100, null, asOf)
    for (const [rootId, replies, halfLife] of [[1, 1, 12], [100, 5, 192], [200, 20, 336]] as const) {
      const stored = database.query('SELECT score,reply_count FROM post_hot WHERE post_id=?').get(rootId) as {
        score: number
        reply_count: number
      }
      const ranked = results.find(result => result.id === rootId)!
      expect(stored.reply_count).toBe(replies)
      expect(ranked.hot_score / stored.score).toBeCloseTo(Math.pow(0.5, 40 / halfLife))
    }
  })

  test('keeps an older widely discussed thread above a brand-new post', () => {
    post(1, '2026-07-27 12:00:00')
    for (let index = 1; index <= 30; index++) {
      postBy(100 + index, 100 + index, '2026-07-27 12:00:00', 1)
    }
    post(2, '2026-08-03 12:00:00')

    const results = getHotPosts(database, 50, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results[0].hot_score).toBeGreaterThan(results.find(result => result.id === 2)!.hot_score)
  })

  test('nested reply boosts halve at each level', () => {
    post(1, '2026-08-03 12:00:00')
    postBy(2, 2, '2026-08-03 12:00:00', 1)
    postBy(3, 3, '2026-08-03 12:00:00', 2)
    postBy(4, 4, '2026-08-03 12:00:00', 3)

    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(0.25 + 2 + 1 + 0.5)

    rebuildHotPosts(database)
    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(0.25 + 2 + 1 + 0.5)
  })

  test('counts only the highest-weight reply from each user for a thread', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-08-03 08:00:00')
    postBy(2, 2, '2026-08-03 09:00:00', 1)
    postBy(2, 3, '2026-08-03 10:00:00', 2)
    postBy(2, 4, '2026-08-03 11:00:00', 1)

    let stored = database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1').get() as {
      score: number
      reply_count: number
      latest_activity_at: string
    }
    expect(stored.reply_count).toBe(1)
    expect(stored.latest_activity_at).toBe('2026-08-03 11:00:00')
    expect(stored.score).toBeCloseTo(0.25 * Math.pow(0.5, 3 / 6) + 2)

    rebuildHotPosts(database)
    stored = database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1').get() as {
      score: number
      reply_count: number
      latest_activity_at: string
    }
    expect(stored.reply_count).toBe(1)
    expect(stored.latest_activity_at).toBe('2026-08-03 11:00:00')
    expect(stored.score).toBeCloseTo(0.25 * Math.pow(0.5, 3 / 6) + 2)
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
      .toBeCloseTo(0.25)
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
    expect(root.hot_score).toBeCloseTo(0.25 * Math.pow(0.5, 4 / 6))

    database.query(`UPDATE post_hot SET score=99,score_updated_at='2026-08-03 11:00:00',
      latest_activity_at='2026-08-03 11:00:00' WHERE post_id=1`).run()
    rebuildHotPosts(database)
    root = getHotPosts(database, 20, null, asOf).find(result => result.id === 1)!
    expect(root.latest_activity_at).toBe('2026-08-03 08:00:00')
    expect(root.hot_score).toBeCloseTo(0.25 * Math.pow(0.5, 4 / 6))
  })

  test('excludes deleted direct replies without promoting their nested replies', () => {
    post(1, '2026-07-30 12:00:00')
    post(2, '2026-08-03 10:00:00', 1, '2026-08-03 10:30:00')
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([3, 1])
    expect(results[1].latest_activity_at).toBe('2026-07-30 12:00:00')
    expect(results[1].hot_score).toBeCloseTo(0.25 * Math.pow(0.5, 96 / 6))
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
    database.query('INSERT INTO post_hot VALUES(?,0,0,?,?)')
      .run(2, '2026-08-03 12:00:00', '2026-08-03 12:00:00')
    recordHotActivity(database, 2)
    database.query('INSERT INTO blocks VALUES(?,?)').run(2, 1)

    const results = getHotPosts(database, 20, null, asOf, 1)
    expect(results.map(result => result.id)).toEqual([1])
    expect(results[0].hot_score).toBeCloseTo(0.25 * Math.pow(0.5, 1 / 6))
  })

  test('hides every post carrying a blocked hashtag', () => {
    post(1, '2026-08-03 11:00:00')
    post(2, '2026-08-03 12:00:00')
    database.run(`INSERT INTO post_hashtags VALUES(2,'spoilers');
      INSERT INTO blocked_hashtags VALUES(1,'spoilers');`)

    expect(getHotPosts(database, 20, null, asOf, 1).map(result => result.id)).toEqual([1])
  })
})
