import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { markAllForYouRead, markForYouEntriesRead, unreadForYouCount } from './for-you-state'
import { runMigrations } from './migrations'

test('reading personalized post events also marks them read in latest', () => {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE posts(id INTEGER PRIMARY KEY);
    CREATE TABLE for_you_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE to_me_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE activity_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE latest_reads(user_id INTEGER,post_id INTEGER,PRIMARY KEY(user_id,post_id));
    INSERT INTO posts(id) VALUES(42);
  `)

  expect(markForYouEntriesRead(7, ['post:00000000000000000042'], true, database)).toBe(2)
  expect(markForYouEntriesRead(7, ['post:00000000000000000042'], true, database)).toBe(0)

  expect(database.query('SELECT post_id FROM latest_reads WHERE user_id=7').all()).toEqual([{ post_id: 42 }])
  expect(database.query('SELECT event_key FROM to_me_reads WHERE user_id=7').all())
    .toEqual([{ event_key: 'post:00000000000000000042' }])
})

test('reading for-you excludes to-me events from latest reads', () => {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE posts(id INTEGER PRIMARY KEY);
    CREATE TABLE for_you_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE to_me_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE activity_reads(user_id INTEGER,event_key TEXT,PRIMARY KEY(user_id,event_key));
    CREATE TABLE latest_reads(user_id INTEGER,post_id INTEGER,PRIMARY KEY(user_id,post_id));
    INSERT INTO posts(id) VALUES(42),(43);
  `)
  const events = ['post:00000000000000000042', 'post:00000000000000000043']

  markForYouEntriesRead(7, events, false, database, [events[0]])

  expect(database.query('SELECT post_id FROM latest_reads WHERE user_id=7').all()).toEqual([{ post_id: 42 }])
  expect(database.query('SELECT event_key FROM for_you_reads WHERE user_id=7 ORDER BY event_key').all())
    .toEqual(events.map(event_key => ({ event_key })))
})

test('mark all clears descendants of followed tags across the whole My Feed', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'topic','2026-08-01 00:00:00');`)
  const insertRoot = database.query('INSERT INTO posts(id,user_id,body,created_at) VALUES(?,?,?,?)')
  const insertReply = database.query('INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(?,?,?,?,?)')
  const insertTag = database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(?,?)')
  for (let index = 1; index <= 21; index++) {
    const rootId = index * 2 - 1
    const replyId = index * 2
    insertRoot.run(rootId, 2, `root ${index}`, `2026-08-${String(index).padStart(2, '0')} 09:00:00`)
    insertTag.run(rootId, 'topic')
    insertReply.run(replyId, 2, rootId, `reply ${index}`, `2026-08-${String(index).padStart(2, '0')} 10:00:00`)
  }

  expect(unreadForYouCount(1, database)).toBe(42)
  markAllForYouRead(1, false, database)
  expect(unreadForYouCount(1, database)).toBe(0)
  expect(database.query(`SELECT count(*) count FROM for_you_reads
    WHERE user_id=1 AND CAST(substr(event_key,6) AS INTEGER)%2=0`).get()).toEqual({ count: 21 })
})
