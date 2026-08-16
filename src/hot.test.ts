import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { getHotPosts, hotCursor, rebuildHotPosts, recordHotActivity, removeHotActivity } from './hot'

const asOf = '2026-08-03T12:00:00.000Z'
let database: Database

beforeEach(() => {
  database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL, account_group_id INTEGER);
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
      activity_count INTEGER NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
  `)
  database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(1, 'tester')
})

function post(id: number, createdAt: string, parentId: number | null = null, deletedAt: string | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, 1, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,0,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
  if (deletedAt) {
    database.query('UPDATE posts SET deleted_at=? WHERE id=?').run(deletedAt, id)
    removeHotActivity(database, id)
  }
}

function postBy(userId: number, id: number, createdAt: string, parentId: number | null = null) {
  database.query('INSERT INTO posts VALUES(?,?,?,?,?,?)')
    .run(id, userId, parentId, `post ${id}`, createdAt, null)
  database.query('INSERT INTO post_hot VALUES(?,0,0,0,?,?)').run(id, createdAt, createdAt)
  recordHotActivity(database, id)
}

describe('hot feed ranking', () => {
  test('excludes reply-free posts', () => {
    post(1, '2026-08-03 12:00:00')
    post(2, '2026-08-02 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results).toEqual([])
  })

  test('ranks a replied thread without considering an unreplied new post', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'replier');
      INSERT INTO users(id,handle) VALUES(3,'another');`)
    post(1, '2026-08-02 12:00:00')
    postBy(2, 2, '2026-08-02 12:00:00', 1)
    postBy(3, 3, '2026-08-02 12:00:00', 1)
    post(4, '2026-08-03 12:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results.find(result => result.id === 1)?.hot_score)
      .toBeCloseTo(0.225 + 0.04 * Math.pow(0.5, 24 / 3))
  })

  test('direct replies give active threads substantially more staying power', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'r2'); INSERT INTO users(id,handle) VALUES(3,'r3');
      INSERT INTO users(id,handle) VALUES(4,'r4'); INSERT INTO users(id,handle) VALUES(5,'r5');`)
    post(1, '2026-08-03 04:00:00')
    postBy(2, 2, '2026-08-03 06:00:00', 1)
    postBy(3, 3, '2026-08-03 06:00:00', 1)
    postBy(4, 4, '2026-08-03 06:00:00', 1)
    postBy(5, 5, '2026-08-03 06:00:00', 1)
    post(6, '2026-08-03 11:00:00')

    const results = getHotPosts(database, 20, null, asOf)
    expect(results[0].id).toBe(1)
    expect(results[0].hot_score).toBeGreaterThan(0)

    rebuildHotPosts(database)
    expect(getHotPosts(database, 20, null, asOf)[0].id).toBe(1)
  })

  test('each distinct replier adds discussion weight without extending the recency half-life', () => {
    for (const [rootId, replies] of [[1, 1], [100, 5], [200, 20]] as const) {
      post(rootId, '2026-08-01 20:00:00')
      for (let index = 1; index <= replies; index++) {
        postBy(1_000 + rootId + index, rootId + index, '2026-08-01 20:00:00', rootId)
      }
    }

    const results = getHotPosts(database, 100, null, asOf)
    for (const [rootId, replies] of [
      [1, 1], [100, 5], [200, 20],
    ] as const) {
      const stored = database.query('SELECT score,reply_count FROM post_hot WHERE post_id=?').get(rootId) as {
        score: number
        reply_count: number
      }
      const ranked = results.find(result => result.id === rootId)!
      expect(stored.reply_count).toBe(replies)
      const participationWeight = replies === 1 ? 0.2 : 1
      const decayedScore = stored.score * participationWeight
          * Math.pow(2, Math.max(0, Math.min(replies, 15) - 5) / 1.5)
          * Math.pow(0.5, 40)
          * (1 + Math.pow(0.5, 40))
      const reserve = replies >= 4
        ? Math.min(0.3, Math.max(0.235, 0.04 * Math.pow(2, (Math.min(replies, 15) - 4) / 1.5))
          + 0.02 * Math.pow(0.5, 40 / 24) + Math.max(0, replies - 4) * 0.001)
        : 0
      expect(ranked.hot_score).toBeCloseTo(Math.max(decayedScore, reserve))
    }
  })

  test('counts personas sharing an account email as one participant', () => {
    database.run(`UPDATE users SET account_group_id=10 WHERE id=1;
      INSERT INTO users(id,handle,account_group_id) VALUES
        (2,'persona-one',20),(3,'persona-two',20),(4,'another-person',30),(5,'author-persona',10);`)
    post(1, '2026-08-03 08:00:00')
    postBy(2, 2, '2026-08-03 09:00:00', 1)
    postBy(3, 3, '2026-08-03 10:00:00', 1)
    postBy(4, 4, '2026-08-03 11:00:00', 1)
    postBy(5, 5, '2026-08-03 12:00:00', 1)

    const stored = database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1')
      .get() as { score: number; reply_count: number; latest_activity_at: string }
    expect(stored.reply_count).toBe(2)
    expect(stored.score).toBeCloseTo(2 * Math.pow(0.5, 2 / 6) + 2 * Math.pow(0.5, 1 / 6))
    expect(stored.latest_activity_at).toBe('2026-08-03 12:00:00')

    rebuildHotPosts(database)
    const rebuilt = database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1')
      .get() as typeof stored
    expect(rebuilt.reply_count).toBe(stored.reply_count)
    expect(rebuilt.latest_activity_at).toBe(stored.latest_activity_at)
    expect(rebuilt.score).toBeCloseTo(stored.score)
  })

  test('keeps a heavily discussed three-day post below fresher discussions but within range', () => {
    post(1, '2026-07-31 12:00:00')
    post(2, '2026-08-02 13:00:00')
    post(3, '2026-08-03 11:00:00')
    database.query(`UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=?
      WHERE post_id=?`).run(3.97, 13, '2026-08-03 06:00:00', '2026-08-03 06:00:00', 1)
    database.query(`UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=?
      WHERE post_id=?`).run(4.04, 6, '2026-08-03 02:00:00', '2026-08-03 02:00:00', 2)
    database.query(`UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=?
      WHERE post_id=?`).run(5.84, 3, '2026-08-03 11:00:00', '2026-08-03 11:00:00', 3)

    const roots = getHotPosts(database, 100, null, asOf)
    expect(roots.map(result => result.id)).toEqual([3, 1, 2])
    expect(roots[0].hot_score).toBeGreaterThan(1.5)
  })

  test('recent comments can outweigh one additional commenter on an older thread', () => {
    post(1, '2026-08-01 12:00:00')
    for (let index = 1; index <= 6; index++) {
      postBy(100 + index, 100 + index, '2026-08-01 12:00:00', 1)
    }
    post(2, '2026-08-03 04:00:00')
    for (let index = 1; index <= 5; index++) {
      postBy(200 + index, 200 + index, '2026-08-03 11:00:00', 2)
    }

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.indexOf(results.find(result => result.id === 2)!))
      .toBeLessThan(results.indexOf(results.find(result => result.id === 1)!))
  })

  test('does not use original post age when reply activity is identical', () => {
    post(1, '2026-07-30 12:00:00')
    postBy(2, 2, '2026-08-03 12:00:00', 1)
    postBy(5, 7, '2026-08-03 12:00:00', 1)
    post(3, '2026-08-03 12:00:00')
    postBy(3, 4, '2026-08-03 12:00:00', 3)
    postBy(6, 8, '2026-08-03 12:00:00', 3)
    post(5, '2026-07-29 12:00:00')
    postBy(4, 6, '2026-08-03 12:00:00', 5)
    postBy(7, 9, '2026-08-03 12:00:00', 5)

    const results = getHotPosts(database, 20, null, asOf)
    const fourDayThread = results.find(result => result.id === 1)!
    const newThread = results.find(result => result.id === 3)!
    const fiveDayThread = results.find(result => result.id === 5)!
    expect(newThread.hot_score).toBeCloseTo(fourDayThread.hot_score)
    expect(fourDayThread.hot_score).toBeCloseTo(fiveDayThread.hot_score)
    expect(newThread.hot_score).toBeCloseTo(0.225 + 0.04)
  })

  test('nine unique repliers outweigh six even when the six-reply thread is older', () => {
    post(1, '2026-07-31 12:00:00')
    for (let index = 1; index <= 6; index++) postBy(100 + index, 100 + index, '2026-07-31 12:00:00', 1)
    post(2, '2026-08-02 15:00:00')
    for (let index = 1; index <= 9; index++) postBy(200 + index, 200 + index, '2026-08-02 15:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.indexOf(results.find(result => result.id === 2)!))
      .toBeLessThan(results.indexOf(results.find(result => result.id === 1)!))
  })

  test('keeps old discussions eligible when their reply activity qualifies', () => {
    post(1, '2026-07-28 12:00:00')
    for (let index = 1; index <= 30; index++) {
      postBy(100 + index, 100 + index, '2026-07-28 12:00:00', 1)
    }
    post(2, '2026-08-03 12:00:00')

    const results = getHotPosts(database, 50, null, asOf)
    const oldThread = results.find(result => result.id === 1)!
    expect(results.map(result => result.id)).toEqual([1])
    expect(oldThread.hot_score).toBeGreaterThan(0)
  })

  test('expires small discussions after four days without comments', () => {
    post(1, '2026-07-28 12:00:00')
    for (let index = 1; index <= 4; index++) {
      postBy(100 + index, 100 + index, '2026-07-29 12:00:00', 1)
    }

    expect(getHotPosts(database, 20, null, asOf)).toEqual([])
  })

  test('uses conversation depth to order the lower two-participant tier', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'one'); INSERT INTO users(id,handle) VALUES(3,'two');`)
    post(1, '2026-08-01 12:00:00')
    postBy(2, 2, '2026-08-01 13:00:00', 1)
    postBy(3, 3, '2026-08-01 14:00:00', 1)
    post(10, '2026-08-01 12:00:00')
    let parentId = 10
    for (let index = 0; index < 8; index++) {
      const id = 11 + index
      postBy(index % 2 ? 2 : 3, id, '2026-08-01 14:00:00', parentId)
      parentId = id
    }

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id).indexOf(10)).toBeLessThan(results.map(result => result.id).indexOf(1))
    expect(database.query('SELECT activity_count FROM post_hot WHERE post_id=10').get())
      .toEqual({ activity_count: 8 })
  })

  test('progressively reduces standalone candidacy at each reply depth', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'reply-author');
      INSERT INTO users(id,handle) VALUES(3,'nested-author');`)
    post(1, '2026-08-01 12:00:00')
    postBy(2, 2, '2026-08-01 13:00:00', 1)
    postBy(3, 3, '2026-08-01 14:00:00', 2)
    database.run(`UPDATE post_hot SET score=4,reply_count=3,activity_count=3,
      score_updated_at='2026-08-03 11:00:00',latest_activity_at='2026-08-03 11:00:00'
      WHERE post_id IN (1,2,3)`)

    const results = getHotPosts(database, 20, null, asOf)
    const root = results.find(result => result.id === 1)!
    const direct = results.find(result => result.id === 2)!
    const nested = results.find(result => result.id === 3)!
    expect(direct.hot_score).toBeCloseTo(root.hot_score * 0.1)
    expect(nested.hot_score).toBeCloseTo(direct.hot_score * 0.6)
  })

  test('keeps a week-old large discussion on hot without outranking fresh replies', () => {
    post(1, '2026-07-27 12:00:00')
    for (let index = 1; index <= 30; index++) {
      postBy(100 + index, 100 + index, '2026-07-27 12:00:00', 1)
    }
    post(2, '2026-08-03 11:00:00')
    for (let index = 1; index <= 4; index++) {
      postBy(200 + index, 200 + index, '2026-08-03 12:00:00', 2)
    }

    const results = getHotPosts(database, 100, null, asOf)
    expect(results.map(result => result.id).slice(0, 2)).toEqual([2, 1])
    expect(results.find(result => result.id === 1)?.hot_score).toBeCloseTo(0.3)
  })

  test('nested reply boosts halve at each level', () => {
    post(1, '2026-08-03 12:00:00')
    postBy(2, 2, '2026-08-03 12:00:00', 1)
    postBy(3, 3, '2026-08-03 12:00:00', 2)
    postBy(4, 4, '2026-08-03 12:00:00', 3)

    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(2 + 1 + 0.5)

    rebuildHotPosts(database)
    expect((database.query('SELECT score FROM post_hot WHERE post_id=1').get() as { score: number }).score)
      .toBeCloseTo(2 + 1 + 0.5)
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
    expect(stored.score).toBeCloseTo(2)

    rebuildHotPosts(database)
    stored = database.query('SELECT score,reply_count,latest_activity_at FROM post_hot WHERE post_id=1').get() as {
      score: number
      reply_count: number
      latest_activity_at: string
    }
    expect(stored.reply_count).toBe(1)
    expect(stored.latest_activity_at).toBe('2026-08-03 11:00:00')
    expect(stored.score).toBeCloseTo(2)
    expect(getHotPosts(database, 20, null, asOf, -1, false, 2).some(result => result.id === 1)).toBeTrue()
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
      .toBeCloseTo(0)
  })

  test('direct and nested replies still rank independently', () => {
    database.query('INSERT INTO users(id,handle) VALUES(?,?)').run(2, 'replier')
    post(1, '2026-07-30 12:00:00')
    postBy(2, 2, '2026-08-03 10:00:00', 1)
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results.map(result => result.id)).toEqual([1, 2])

    rebuildHotPosts(database)
    const rebuilt = getHotPosts(database, 20, null, asOf)
    expect(rebuilt.map(result => result.id)).toEqual([1, 2])
  })

  test('lets one-reply posts briefly enter the front-page hot feed', () => {
    database.run(`INSERT INTO users(id,handle) VALUES(2,'recent-replier');
      INSERT INTO users(id,handle) VALUES(3,'older-replier');`)
    post(1, '2026-08-03 10:00:00')
    postBy(2, 2, '2026-08-03 08:01:00', 1)
    post(3, '2026-08-03 07:00:00')
    postBy(3, 4, '2026-08-03 07:59:00', 3)

    const results = getHotPosts(database, 20, null, asOf, -1, false, 2)
    expect(results.some(result => result.id === 1)).toBeTrue()
    expect(results.some(result => result.id === 3)).toBeFalse()
  })

  test('does not let authors boost their own posts with direct replies', () => {
    post(1, '2026-08-03 08:00:00')
    post(2, '2026-08-03 11:00:00', 1)

    expect(getHotPosts(database, 20, null, asOf).some(result => result.id === 1)).toBeFalse()

    database.query(`UPDATE post_hot SET score=99,score_updated_at='2026-08-03 11:00:00',
      latest_activity_at='2026-08-03 11:00:00' WHERE post_id=1`).run()
    rebuildHotPosts(database)
    expect(getHotPosts(database, 20, null, asOf).some(result => result.id === 1)).toBeFalse()
  })

  test('excludes deleted direct replies without promoting their nested replies', () => {
    post(1, '2026-07-30 12:00:00')
    post(2, '2026-08-03 10:00:00', 1, '2026-08-03 10:30:00')
    post(3, '2026-08-03 11:00:00', 2)

    const results = getHotPosts(database, 20, null, asOf)
    expect(results).toEqual([])
  })

  test('uses deterministic tie-breakers and pagination', () => {
    post(1, '2026-08-03 11:00:00')
    post(2, '2026-08-03 11:00:00')
    post(3, '2026-08-03 10:00:00')
    database.run(`UPDATE post_hot SET score=4,reply_count=2 WHERE post_id IN (1,2,3)`)

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
    database.query('INSERT INTO post_hot VALUES(?,0,0,0,?,?)')
      .run(2, '2026-08-03 12:00:00', '2026-08-03 12:00:00')
    recordHotActivity(database, 2)
    database.run(`UPDATE post_hot SET score=4,reply_count=2 WHERE post_id IN (1,2)`)
    database.query('INSERT INTO blocks VALUES(?,?)').run(2, 1)

    const results = getHotPosts(database, 20, null, asOf, 1)
    expect(results.map(result => result.id)).toEqual([1])
    expect(results[0].hot_score).toBeGreaterThan(0)
  })

  test('hides every post carrying a blocked hashtag', () => {
    post(1, '2026-08-03 11:00:00')
    post(2, '2026-08-03 12:00:00')
    database.run(`UPDATE post_hot SET score=4,reply_count=2 WHERE post_id IN (1,2)`)
    database.run(`INSERT INTO post_hashtags VALUES(2,'spoilers');
      INSERT INTO blocked_hashtags VALUES(1,'spoilers');`)

    expect(getHotPosts(database, 20, null, asOf, 1).map(result => result.id)).toEqual([1])
  })
})
