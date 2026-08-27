import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { markLatestPostsRead } from './latest-state'
import { runMigrations } from './migrations'

test('latest count excludes posts consumed by the rendered page', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (1,2,'first','2026-08-27 09:00:00'),(2,2,'second','2026-08-27 10:00:00');`)
  cacheDb.query("DELETE FROM feed_snapshots WHERE kind='latest-conversation-heads-v10' AND viewer_id=1").run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1, page: 1, pageSize: 20,
  })

  expect(feed.unreadPostIds).toEqual([2, 1])
  expect(feed.latestCount).toBe(0)
  expect(feed.latestUnread).toBe(false)
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)
})

test('latest includes unread replies beyond the normal conversation preview', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'root','2026-08-26 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (11,2,10,'old unread','2026-08-26 10:00:00'),
    (12,2,10,'reply 2','2026-08-26 11:00:00'),(13,2,10,'reply 3','2026-08-26 12:00:00'),
    (14,2,10,'reply 4','2026-08-26 13:00:00'),(15,2,10,'reply 5','2026-08-26 14:00:00'),
    (16,2,10,'reply 6','2026-08-26 15:00:00');`)
  markLatestPostsRead(1, [10, 12, 13, 14, 15, 16], database)
  cacheDb.query("DELETE FROM feed_snapshots WHERE kind='latest-conversation-heads-v10' AND viewer_id=1").run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1, page: 1, pageSize: 20,
  })

  expect(feed.posts.map(post => post.id)).toContain(11)
  expect(feed.unreadPostIds).toEqual([11])
  expect(feed.latestCount).toBe(0)
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)
})
