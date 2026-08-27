import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
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
