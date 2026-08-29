import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { getHotPosts, hotFeedProjectionNeedsRefresh, hotScoresNeedRebuild, recordHotActivity } from './hot'
import { latestMigrationVersion, runMigrations } from './migrations'

function database() {
  const db = new Database(':memory:', { strict: true })
  db.run('PRAGMA foreign_keys=ON')
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'alice','alice@example.test','x'),(2,'bob','bob@example.test','x'),
    (3,'charlie','charlie@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
      (10,1,'first','2026-08-27 09:00:00'),(20,2,'second','2026-08-27 09:30:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (11,2,10,'reply','2026-08-27 10:00:00'),
      (21,1,20,'reply','2026-08-27 10:10:00'),
      (22,3,20,'another reply','2026-08-27 10:20:00');`)
  for (const id of [11, 21, 22]) recordHotActivity(db, id)
  return db
}

test('background hot projection preserves canonical ranking order', async () => {
  const db = database()
  const now = new Date('2026-08-27T10:30:00.000Z')
  expect(hotFeedProjectionNeedsRefresh(db, now.getTime())).toBeTrue()

  const refreshed = await executeDatabaseDomain(db, 'feeds.refreshHotProjection', {
    force: true,
    now: now.toISOString(),
  })
  expect(refreshed.refreshed).toBeTrue()
  expect(hotFeedProjectionNeedsRefresh(db, now.getTime())).toBeFalse()

  const expected = getHotPosts(db, 1_000_000, null, now, -1, false, 2, false).map(post => post.id)
  const projected = (db.query('SELECT post_id FROM hot_feed_projection ORDER BY post_rank').all() as Array<{
    post_id: number
  }>).map(row => row.post_id)
  expect(projected).toEqual(expected)
})

test('hot enriches ranked roots with the same two-to-five recent replies as latest', async () => {
  const db = new Database(':memory:', { strict: true })
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'root','root@example.test','x'),(2,'first','first@example.test','x'),
    (3,'second','second@example.test','x');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (100,1,NULL,'root','2026-08-20 09:00:00'),
    (101,2,100,'reply 1','2026-08-27 09:00:00'),
    (102,3,100,'reply 2','2026-08-27 10:00:00'),
    (103,2,100,'reply 3','2026-08-27 11:00:00'),
    (104,3,100,'reply 4','2026-08-27 12:00:00'),
    (105,2,100,'reply 5','2026-08-27 13:00:00'),
    (106,3,100,'reply 6','2026-08-27 14:00:00');`)
  for (const id of [101, 102, 103, 104, 105, 106]) recordHotActivity(db, id)
  await executeDatabaseDomain(db, 'feeds.refreshHotProjection', {
    force: true,
    now: '2026-08-27T15:00:00.000Z',
  })

  const latest = await executeDatabaseDomain(db, 'feeds.latestPage', {
    viewerId: -1, page: 1, pageSize: 20, markRead: false,
  })
  const hot = await executeDatabaseDomain(db, 'feeds.hotPage', { viewerId: -1, page: 1, pageSize: 20 })
  const conversationIds = (posts: typeof latest.posts) => posts
    .filter(post => post.id === 100 || post.parent?.id === 100 || post.parent_id === 100)
    .map(post => post.id)

  expect(conversationIds(hot.posts)).toEqual(conversationIds(latest.posts))
  expect(conversationIds(hot.posts)).toEqual([100, 106, 105, 104, 103, 102])
})

test('hot activity dirties the projection and clean projections age out', async () => {
  const db = database()
  const now = new Date('2026-08-27T10:30:00.000Z')
  await executeDatabaseDomain(db, 'feeds.refreshHotProjection', { force: true, now: now.toISOString() })
  expect(hotFeedProjectionNeedsRefresh(db, now.getTime() + 4 * 60_000)).toBeFalse()
  expect(hotFeedProjectionNeedsRefresh(db, now.getTime() + 6 * 60_000)).toBeTrue()

  db.run(`UPDATE post_hot SET score=score+1 WHERE post_id=10`)
  expect(hotFeedProjectionNeedsRefresh(db, now.getTime())).toBeTrue()
})

test('upgrades a deployed version 151 hot projection state', () => {
  const db = new Database(':memory:', { strict: true })
  db.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY);
    CREATE TABLE post_hot(post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0);
    CREATE TABLE hot_feed_projection_state(
      id INTEGER PRIMARY KEY,dirty INTEGER NOT NULL,ranking_version INTEGER NOT NULL,refreshed_at TEXT
    );
    INSERT INTO hot_feed_projection_state VALUES(1,0,108,CURRENT_TIMESTAMP);
    PRAGMA user_version=151;`)

  expect(runMigrations(db)).toBe(latestMigrationVersion)
  expect(db.query("SELECT 1 FROM pragma_table_info('hot_feed_projection_state') WHERE name='generation'").get())
    .toEqual({ 1: 1 })
  db.run('INSERT INTO post_hot(post_id) VALUES(1)')
  expect(db.query('SELECT dirty,generation FROM hot_feed_projection_state').get())
    .toEqual({ dirty: 1, generation: 1 })
})

test('hot score integrity only requests a full rebuild for missing rows', () => {
  const db = database()
  expect(hotScoresNeedRebuild(db)).toBeFalse()
  db.run('DELETE FROM post_hot WHERE post_id=10')
  expect(hotScoresNeedRebuild(db)).toBeTrue()
})
