import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { initializeLatestReads, latestPostState, markLatestPostsRead } from './latest-state'

test('latest unread state includes the viewer own posts and decreases as a page is read', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,
    deleted_at TEXT);
  CREATE TABLE latest_reads (user_id INTEGER NOT NULL,post_id INTEGER NOT NULL,PRIMARY KEY(user_id,post_id));
  CREATE TABLE post_mentions (post_id INTEGER,user_id INTEGER);
  CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
  CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
  CREATE TABLE blocked_hashtags (user_id INTEGER,tag TEXT);
  INSERT INTO posts(id,user_id,parent_id) VALUES(1,1,NULL),(2,2,NULL),(3,1,NULL);`)

  expect(latestPostState(1, database).filter(row => row.unread).map(row => row.id)).toEqual([3, 2, 1])
  markLatestPostsRead(1, [3, 2], database)
  expect(latestPostState(1, database).filter(row => row.unread).map(row => row.id)).toEqual([1])
})

test('new users start with every existing latest post read', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,
    deleted_at TEXT);
  CREATE TABLE latest_reads (user_id INTEGER NOT NULL,post_id INTEGER NOT NULL,PRIMARY KEY(user_id,post_id));
  INSERT INTO posts(id,user_id,parent_id) VALUES(1,1,NULL),(2,2,NULL);`)

  initializeLatestReads(3, database)
  expect(database.query('SELECT post_id FROM latest_reads WHERE user_id=3 ORDER BY post_id').all())
    .toEqual([{ post_id: 1 }, { post_id: 2 }])
})

test('a newly created own post can be marked read without affecting other users', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,
    deleted_at TEXT);
  CREATE TABLE latest_reads (user_id INTEGER NOT NULL,post_id INTEGER NOT NULL,PRIMARY KEY(user_id,post_id));
  CREATE TABLE post_mentions (post_id INTEGER,user_id INTEGER);
  CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
  CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
  CREATE TABLE blocked_hashtags (user_id INTEGER,tag TEXT);
  INSERT INTO posts(id,user_id,parent_id) VALUES(1,1,NULL);`)

  markLatestPostsRead(1, [1], database)
  expect(latestPostState(1, database)[0].unread).toBe(0)
  expect(latestPostState(2, database)[0].unread).toBe(1)
})
