import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { unreadForYouCount } from './for-you-state'
import { markLatestPostsRead } from './latest-state'
import { runMigrations } from './migrations'

test('latest count remains for the rendered page and is reduced on the next load', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (1,2,'first','2026-08-27 09:00:00'),(2,2,'second','2026-08-27 10:00:00');`)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })

  expect(feed.unreadPostIds).toEqual([2, 1])
  expect(feed.latestCount).toBe(2)
  expect(feed.latestUnread).toBe(true)
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)

  const nextFeed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })
  expect(nextFeed.latestCount).toBe(0)
  expect(nextFeed.latestUnread).toBe(false)
})

test('reading My Feed reduces the All counter before All renders', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-27 08:00:00');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (1,2,'first','2026-08-27 09:00:00'),(2,2,'second','2026-08-27 10:00:00');`)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const myFeed = await executeDatabaseDomain(database, 'feeds.personalizedPage', {
    user: database.query('SELECT * FROM users WHERE id=1').get() as any,
    page: 1,
    pageSize: 20,
    toMe: false,
    path: '/my-feed',
  })
  expect(myFeed.forYouCount).toBe(2)
  expect(myFeed.latestCount).toBe(0)

  const allFeed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })
  expect(allFeed.latestCount).toBe(0)
  expect(allFeed.latestUnread).toBe(false)
})

test('reading All does not consume matching unread My Feed activity', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-27 08:00:00');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (1,2,'first','2026-08-27 09:00:00'),(2,2,'second','2026-08-27 10:00:00');`)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const allFeed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })

  expect(allFeed.unreadPostIds).toEqual([2, 1])
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)
  expect(unreadForYouCount(1, database)).toBe(2)
  const myFeed = await executeDatabaseDomain(database, 'feeds.personalizedPage', {
    user: database.query('SELECT * FROM users WHERE id=1').get() as any,
    page: 1,
    pageSize: 20,
    toMe: false,
    path: '/my-feed',
    markRead: false,
  })
  expect(myFeed.forYouCount).toBe(2)
  expect(myFeed.timeline.filter(row => row.unread).map(row => row.id)).toEqual([2, 1])
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
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })

  expect(feed.posts.map(post => post.id)).toContain(11)
  expect(feed.unreadPostIds).toEqual([11])
  expect(feed.latestCount).toBe(1)
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)
})

test('latest keeps up to five replies available when the recent root is present', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(100,2,'root','2026-08-27 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (101,2,100,'recent ancestor','2026-08-27 10:00:00'),
    (102,2,101,'recent child','2026-08-27 11:00:00'),
    (103,2,102,'newest child','2026-08-27 12:00:00');`)
  markLatestPostsRead(1, [100, 101, 102, 103], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })

  expect(feed.posts.map(post => post.id)).toEqual([100, 103, 102, 101])
})

test('latest keeps a rooted conversation available for five-reply expansion', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(200,2,'root','2026-08-27 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (201,2,200,'first','2026-08-27 10:00:00'),(202,2,201,'second','2026-08-27 11:00:00'),
    (203,2,202,'third','2026-08-27 12:00:00'),(204,2,203,'fourth','2026-08-27 13:00:00');`)
  markLatestPostsRead(1, [200, 201, 202, 203, 204], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const preview = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })
  expect(preview.posts.map(post => post.id)).toEqual([200, 204, 203, 202, 201])
})

test('latest fills a fifth connected reply slot while retaining unread replies', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(300,2,'root','2026-08-27 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (301,2,300,'one','2026-08-27 10:00:00'),(302,2,300,'two','2026-08-27 11:00:00'),
    (303,2,300,'three','2026-08-27 12:00:00'),(304,2,300,'four','2026-08-27 13:00:00'),
    (305,2,300,'five','2026-08-27 14:00:00'),(306,2,300,'six','2026-08-27 15:00:00'),
    (307,2,300,'seven','2026-08-27 16:00:00');`)
  markLatestPostsRead(1, [300, 302, 303, 304, 305, 306, 307], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })

  expect(feed.posts.map(post => post.id)).toEqual([300, 307, 306, 305, 304, 303, 301])
})

test('latest anchors an active branch at its oldest recent reply and quotes the older parent', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(100,2,'old root','2026-08-20 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (101,2,100,'old quoted parent','2026-08-20 10:00:00'),
    (102,2,101,'active branch root','2026-08-27 09:00:00'),
    (103,2,102,'recent child','2026-08-27 10:00:00'),
    (104,2,103,'newest child','2026-08-27 11:00:00');`)
  markLatestPostsRead(1, [100, 101], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })

  expect(feed.posts.map(post => post.id)).toEqual([104, 103, 102, 101])
  expect(feed.posts.find(post => post.id === 101)).toMatchObject({
    parent_id: 100,
    feed_branch_root: true,
    parent: { id: 100 },
  })
})

test('latest keeps an old root and unread intermediates when recent direct replies accompany a newer deep run', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(1495,2,'old root','2026-08-16 14:10:58');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (2904,2,1495,'older recent direct','2026-08-30 13:20:03'),
    (2953,2,1495,'newer recent direct','2026-08-31 15:42:10'),
    (2954,2,2953,'deep intermediate one','2026-08-31 15:47:09'),
    (2955,2,2954,'deep intermediate two','2026-08-31 15:53:24'),
    (2956,2,2955,'newest deep reply','2026-08-31 15:54:59');`)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const feed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })

  expect(feed.posts.map(post => post.id)).toEqual([1495, 2956, 2955, 2954, 2953, 2904])
})

test('Any deterministically shuffles the full conversation pool from its seed', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'writer\',\'writer@example.test\',\'x\')')
  const insert = database.query('INSERT INTO posts(id,user_id,body,created_at) VALUES(?,1,?,?)')
  for (let id = 1; id <= 21; id++) {
    insert.run(id, `post ${id}`, `2026-08-${String(id).padStart(2, '0')} 10:00:00`)
  }
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind LIKE \'latest-conversation-heads-v13:any:%\' AND viewer_id=-120')
    .run()

  const first = await executeDatabaseDomain(database, 'feeds.randomPage', {
    viewerId: -120,
    pageSize: 20,
    sampleSeed: 123,
  })
  const repeated = await executeDatabaseDomain(database, 'feeds.randomPage', {
    viewerId: -120,
    pageSize: 20,
    sampleSeed: 123,
  })
  const reshuffled = await executeDatabaseDomain(database, 'feeds.randomPage', {
    viewerId: -120,
    pageSize: 20,
    sampleSeed: 456,
  })

  expect(first.randomSampleSeed).toBe(123)
  expect(first.posts).toHaveLength(20)
  expect(repeated.posts.map(post => post.id)).toEqual(first.posts.map(post => post.id))
  expect(reshuffled.posts.map(post => post.id)).not.toEqual(first.posts.map(post => post.id))
})

test('New and Any apply viewer blocks after selecting their shared public projection', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'blocked','blocked@example.test','x'),
    (3,'visible','visible@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (1,2,'blocked author','2026-09-01 10:00:00'),
    (2,3,'#hidden topic','2026-09-02 10:00:00'),
    (3,3,'visible topic','2026-09-03 10:00:00');
    INSERT INTO post_hashtags(post_id,tag) VALUES(2,'hidden');
    INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,2);
    INSERT INTO blocked_hashtags(user_id,tag) VALUES(1,'hidden');`)

  const fresh = await executeDatabaseDomain(database, 'feeds.newPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })
  const random = await executeDatabaseDomain(database, 'feeds.randomPage', {
    viewerId: 1,
    pageSize: 20,
    sampleSeed: 123,
  })

  expect(fresh.posts.map(post => post.id)).toEqual([3])
  expect(random.posts.map(post => post.id)).toEqual([3])
})
