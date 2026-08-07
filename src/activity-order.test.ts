import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { activityOrderBy } from './activity-order'

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
