import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { canReadPrivatePost } from './private'

test('private branches require a signed-in author or mention and enforce every ancestor gate', () => {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER);
    CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
    CREATE TABLE post_mentions(post_id INTEGER,user_id INTEGER);
    INSERT INTO posts VALUES(1,1,NULL),(2,1,1),(3,2,2),(4,2,3),(5,1,1);
    INSERT INTO post_hashtags VALUES(2,'private'),(4,'private');
    INSERT INTO post_mentions VALUES(2,2),(3,3),(4,4);`)
  expect(canReadPrivatePost(db, 1)).toBe(true)
  expect(canReadPrivatePost(db, 5)).toBe(true)
  for (const id of [2, 3, 4]) {
    expect(canReadPrivatePost(db, id)).toBe(false)
    expect(canReadPrivatePost(db, id, 99)).toBe(false)
  }
  for (const user of [1, 2, 3, 4]) expect(canReadPrivatePost(db, 2, user)).toBe(true)
  expect(canReadPrivatePost(db, 3, 3)).toBe(true)
  expect(canReadPrivatePost(db, 4, 1)).toBe(false)
  expect(canReadPrivatePost(db, 4, 2)).toBe(true)
  expect(canReadPrivatePost(db, 4, 4)).toBe(true)
  db.close()
})

test('a private reply includes its parent author throughout the branch without an explicit mention', () => {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER);
    CREATE TABLE post_hashtags(post_id INTEGER,tag TEXT);
    CREATE TABLE post_mentions(post_id INTEGER,user_id INTEGER);
    INSERT INTO posts VALUES(1,9,NULL),(2,2,1),(3,2,2),(4,9,3),(5,2,NULL);
    INSERT INTO post_hashtags VALUES(2,'private'),(5,'private');`)
  for (const id of [2, 3, 4]) {
    expect(canReadPrivatePost(db, id, 9)).toBe(true)
    expect(canReadPrivatePost(db, id, 2)).toBe(true)
    expect(canReadPrivatePost(db, id, 99)).toBe(false)
    expect(canReadPrivatePost(db, id)).toBe(false)
  }
  expect(canReadPrivatePost(db, 5, 9)).toBe(false)
  expect(db.query('SELECT * FROM post_mentions').all()).toEqual([])
  db.close()
})

test('private follow and block actions are inert and legacy relationships are removed', async () => {
  const { runMigrations } = await import('./migrations')
  const { executeDatabaseDomain } = await import('./database-domain')
  const db = new Database(':memory:')
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'writer','private-writer@example.com','x');
    DROP TRIGGER ignore_private_hashtag_follows_insert;
    DROP TRIGGER ignore_private_hashtag_follows_update;
    DROP TRIGGER ignore_private_blocked_hashtags_insert;
    DROP TRIGGER ignore_private_blocked_hashtags_update;
    INSERT INTO hashtag_follows(user_id,tag) VALUES(1,'private');
    INSERT INTO blocked_hashtags(user_id,tag) VALUES(1,'private');
    PRAGMA user_version=227;`)
  runMigrations(db)
  for (const action of ['follow', 'unfollow', 'block', 'unblock'] as const) {
    expect(await executeDatabaseDomain(db, 'api.tagRelationshipMutation', { userId: 1, tag: 'private', action }))
      .toEqual({ changed: false })
  }
  expect(await executeDatabaseDomain(db, 'interactions.toggleTagFollow', { userId: 1, tag: 'private' }))
    .toEqual({ followed: false })
  expect(await executeDatabaseDomain(db, 'interactions.toggleTagBlock', { userId: 1, tag: 'private' }))
    .toEqual({ blocked: false })
  for (const table of ['hashtag_follows', 'blocked_hashtags']) {
    expect(db.query(`SELECT 1 FROM ${table} WHERE tag='private'`).get()).toBeNull()
    db.run(`INSERT INTO ${table}(user_id,tag) VALUES(1,'private')`)
    expect(db.query(`SELECT 1 FROM ${table} WHERE tag='private'`).get()).toBeNull()
    db.run(`INSERT INTO ${table}(user_id,tag) VALUES(1,'ordinary');
      UPDATE ${table} SET tag='private' WHERE tag='ordinary';`)
    expect(db.query(`SELECT tag FROM ${table}`).all()).toEqual([{ tag: 'ordinary' }])
  }
  db.close()
})
