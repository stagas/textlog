import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { recordHotActivity } from './hot'
import { runMigrations } from './migrations'
import { createPost } from './posts'
import type { User } from './types'

test('meta aliases hide tagged posts and descendants from all and any while preserving hot and followed delivery',
  async () => {
  const db = new Database(':memory:', { strict: true })
  runMigrations(db)
  db.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO follows(follower_id,following_id,created_at)
      VALUES(1,2,'2026-08-01 08:00:00');`)

  const root = createPost(db, 2, 'internal #tlog', null, false)
  if (!('id' in root)) throw new Error('expected root post')
  const reply = createPost(db, 1, 'untagged descendant', root.id, false)
  if (!('id' in reply)) throw new Error('expected reply post')
  recordHotActivity(db, reply.id)
  await executeDatabaseDomain(db, 'feeds.refreshHotProjection', {
    force: true, now: new Date().toISOString(),
  })
  cacheDb.query("DELETE FROM feed_snapshots WHERE kind='latest-conversation-heads-v12'").run()

  const all = await executeDatabaseDomain(db, 'feeds.latestPage', {
    viewerId: -1, page: 1, pageSize: 20, markRead: false,
  })
  const any = await executeDatabaseDomain(db, 'feeds.randomPage', { viewerId: -1, pageSize: 20 })
  const hot = await executeDatabaseDomain(db, 'feeds.hotPage', { viewerId: -1, page: 1, pageSize: 20 })
  expect(all.posts).toEqual([])
  expect(any.posts).toEqual([])
  expect(hot.posts.map(post => post.id)).toContain(root.id)
  expect(db.query('SELECT tag FROM post_hashtags WHERE post_id=?').get(root.id)).toEqual({ tag: 'tlog' })

  const reader = db.query('SELECT * FROM users WHERE id=1').get() as User
  const myFeed = await executeDatabaseDomain(db, 'feeds.personalizedPage', {
    user: reader, page: 1, pageSize: 20, toMe: false, path: '/my-feed', markRead: false,
  })
  expect(myFeed.timeline.some(row => row.id === reply.id)).toBeTrue()
})
