import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { activityOrderBy, decodeActivityCursor, encodeActivityCursor } from './activity-order'

test('activity cursors round trip and reject malformed boundaries', () => {
  const cursor = { timestamp: 1786118400, key: 'post:42', direction: 'next' as const }
  expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor)
  expect(decodeActivityCursor('broken')).toBeNull()
  expect(decodeActivityCursor(Buffer.from(JSON.stringify([1, null, 'post:42', 'next'])).toString('base64url')))
    .toBeNull()
})

test('activity ordering interleaves follows and posts by normalized event time', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE events(kind TEXT,created_at TEXT,activity_key TEXT);
    INSERT INTO events VALUES
      ('post','2026-08-07 11:00:00','post:1'),
      ('follow','2026-08-07T12:00:00.000Z','follow:2'),
      ('post','2026-08-07 13:00:00','post:3'),
      ('follow','2026-08-07 10:00:00','follow:4');`)

  const events = database.query(
    `SELECT activity.kind FROM events activity ORDER BY ${activityOrderBy}`,
  ).all()

  expect(events).toEqual([{ kind: 'post' }, { kind: 'follow' }, { kind: 'post' }, { kind: 'follow' }])
})

test('activity ordering normalizes production Unix follow timestamps', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE events(kind TEXT,created_at,activity_key TEXT);
    INSERT INTO events VALUES
      ('post','2026-08-07 13:00:00','post:1'),
      ('follow',1786111200,'follow:seconds'),
      ('follow',1786114800000,'follow:milliseconds'),
      ('follow',1786118400000000,'follow:microseconds');`)

  const events = database.query(
    `SELECT activity.activity_key FROM events activity ORDER BY ${activityOrderBy}`,
  ).all()

  expect(events).toEqual([
    { activity_key: 'follow:microseconds' },
    { activity_key: 'follow:milliseconds' },
    { activity_key: 'follow:seconds' },
    { activity_key: 'post:1' },
  ])
})

test('follow union columns align with migrated post column order', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE posts (
      id INTEGER,user_id INTEGER,body TEXT,created_at TEXT,parent_id INTEGER,deleted_at TEXT);
    CREATE TABLE follows(follower_id INTEGER,created_at TEXT);
    INSERT INTO posts VALUES(1,1,'reply','2026-08-07 15:54:06',10,NULL);
    INSERT INTO follows VALUES(2,'2026-08-07 15:54:38');`)

  const events = database.query(`SELECT activity_kind,created_at FROM (
      SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,'reply' activity_kind,
        'post:' || p.id activity_key
        FROM posts p
      UNION ALL
      SELECT NULL,f.follower_id,NULL,NULL,f.created_at,NULL,'follow','follow:' || f.follower_id FROM follows f
    ) activity ORDER BY ${activityOrderBy}`).all()

  expect(events).toEqual([
    { activity_kind: 'follow', created_at: '2026-08-07 15:54:38' },
    { activity_kind: 'reply', created_at: '2026-08-07 15:54:06' },
  ])
})
