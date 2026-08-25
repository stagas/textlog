import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { markForYouEntriesRead } from './for-you-state'

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

  markForYouEntriesRead(7, ['post:00000000000000000042'], true, database)

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
