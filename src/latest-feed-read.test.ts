import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { unreadForYouCount } from './for-you-state'
import { markLatestPostsRead, unreadLatestCount } from './latest-state'
import { runMigrations } from './migrations'

function replyReadMatrixDatabase() {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'root','2026-08-27 09:00:00');
    INSERT INTO for_you_reads(user_id,event_key) VALUES(1,'post:00000000000000000010');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(11,2,10,'direct reply','2026-08-27 10:00:00');`)
  markLatestPostsRead(1, [10], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE viewer_id=1').run()
  return database
}

async function openPersonalized(database: Database, toMe: boolean, markRead = true) {
  return executeDatabaseDomain(database, 'feeds.personalizedPage', {
    user: database.query('SELECT * FROM users WHERE id=1').get() as any,
    page: 1,
    pageSize: 20,
    toMe,
    path: toMe ? '/to-me' : '/my-feed',
    markRead,
  })
}

test('All hides dropped-username posts except for moderators', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'anon123456789abc','hidden@example.test','x'),
    (3,'moderator','gstagas@gmail.com','x');
    INSERT INTO posts(id,user_id,body) VALUES(1,2,'hidden post');
    INSERT INTO banned_usernames(username,dropped_user_id,dropped_by) VALUES('writer',2,3)`)

  expect(unreadLatestCount(1, database)).toBe(0)
  expect(unreadLatestCount(3, database)).toBe(1)
  const publicFeed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })
  const moderatorFeed = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 3,
    page: 1,
    pageSize: 20,
    markRead: false,
  })
  expect(publicFeed.posts).toEqual([])
  expect(moderatorFeed.posts.map(post => post.id)).toEqual([1])
  expect(moderatorFeed.posts[0].hidden_post).toBeTrue()
})

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

test('New counts and consumes only top-level posts, including roots read in My Feed', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-27 08:00:00');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(1,2,'root','2026-08-27 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(2,2,1,'reply','2026-08-27 10:00:00');`)

  const counts = await executeDatabaseDomain(database, 'feeds.unreadCounts', { userId: 1 })
  expect(counts).toMatchObject({ latestCount: 2, newCount: 1 })

  const myFeed = await openPersonalized(database, false)
  expect(myFeed.newCount).toBe(0)

  const newFeed = await executeDatabaseDomain(database, 'feeds.newPage', {
    viewerId: 1, page: 1, pageSize: 20,
  })
  expect(newFeed.newCount).toBe(0)
  expect(newFeed.unreadPostIds).toEqual([])
})

test('opening New consumes its visible roots but leaves unread replies in All', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(1,2,'root','2026-08-27 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(2,2,1,'reply','2026-08-27 10:00:00');`)

  const first = await executeDatabaseDomain(database, 'feeds.newPage', {
    viewerId: 1, page: 1, pageSize: 20,
  })
  expect(first.newCount).toBe(1)
  expect(first.unreadPostIds).toEqual([1])

  const counts = await executeDatabaseDomain(database, 'feeds.unreadCounts', { userId: 1 })
  expect(counts).toMatchObject({ latestCount: 1, newCount: 0 })
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

test('direct-reply badges obey the complete All, My Feed, and @ read matrix', async () => {
  {
    const database = replyReadMatrixDatabase()
    const first = await executeDatabaseDomain(database, 'feeds.latestPage', {
      viewerId: 1,
      page: 1,
      pageSize: 20,
    })
    expect(first.latestCount).toBe(1)
    expect(first.unreadPostIds).toContain(11)
    expect(unreadForYouCount(1, database)).toBe(1)
    expect((await openPersonalized(database, true, false)).toMeCount).toBe(1)

    const second = await executeDatabaseDomain(database, 'feeds.latestPage', {
      viewerId: 1,
      page: 1,
      pageSize: 20,
    })
    expect(second.latestCount).toBe(0)
    expect(second.unreadPostIds).toEqual([])
    expect((await openPersonalized(database, false, false)).forYouCount).toBe(1)
    expect((await openPersonalized(database, true, false)).toMeCount).toBe(1)
  }

  {
    const database = replyReadMatrixDatabase()
    const first = await openPersonalized(database, false)
    expect(first.forYouCount).toBe(1)
    expect(first.timeline.find(row => row.id === 11)?.unread).toBeTruthy()
    expect(first.latestCount).toBe(0)
    expect(first.toMeCount).toBe(1)

    const second = await openPersonalized(database, false)
    expect(second.forYouCount).toBe(0)
    expect(second.timeline.some(row => row.unread)).toBeFalse()
    expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)
    expect((await openPersonalized(database, true, false)).toMeCount).toBe(1)
  }

  {
    const database = replyReadMatrixDatabase()
    const first = await openPersonalized(database, true)
    expect(first.toMeCount).toBe(1)
    expect(first.timeline.find(row => row.id === 11)?.unread).toBeTruthy()
    expect(first.forYouCount).toBe(1)
    expect(first.latestCount).toBe(1)

    const second = await openPersonalized(database, true)
    expect(second.toMeCount).toBe(0)
    expect(second.timeline.some(row => row.unread)).toBeFalse()
    expect((await openPersonalized(database, false, false)).forYouCount).toBe(1)
    expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(1)
  }
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

test('latest exposes and consumes an unread reply omitted from a deep branch preview', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(20,2,'root','2026-08-26 09:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
    (21,2,20,'deep unread','2026-08-26 10:00:00'),
    (22,2,21,'depth 2','2026-08-26 11:00:00'),
    (23,2,22,'depth 3','2026-08-26 12:00:00'),
    (24,2,23,'depth 4','2026-08-26 13:00:00'),
    (25,2,24,'depth 5','2026-08-26 14:00:00'),
    (26,2,25,'depth 6','2026-08-26 15:00:00'),
    (27,2,26,'depth 7','2026-08-26 16:00:00');`)
  markLatestPostsRead(1, [20, 21, 22, 24, 25, 26, 27], database)
  cacheDb.query('DELETE FROM feed_snapshots WHERE kind=\'latest-conversation-heads-v13\' AND viewer_id=1').run()

  const first = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })

  expect(first.latestCount).toBe(1)
  expect(first.unreadPostIds).toEqual([23])
  expect(first.posts.find(post => post.id === 23)).toMatchObject({ feed_ancestor_gap: true })
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: 1 })).toBe(0)

  const second = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })
  expect(second.latestCount).toBe(0)
  expect(second.unreadPostIds).toEqual([])
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

test('numbered All pages use cursor boundaries without duplicate conversations', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'writer\',\'writer@example.test\',\'x\')')
  const insert = database.query('INSERT INTO posts(id,user_id,body,created_at) VALUES(?,1,?,?)')
  for (let id = 1; id <= 41; id++) insert.run(id, `post ${id}`, `2026-08-01 10:${String(id).padStart(2, '0')}:00`)
  cacheDb.query('DELETE FROM global_feed_page_cursors WHERE kind=\'latest\' AND viewer_id=-121').run()

  const pages = await Promise.all([1, 2, 3].map(page =>
    executeDatabaseDomain(database, 'feeds.latestPage', {
      viewerId: -121,
      page,
      pageSize: 20,
      markRead: false,
    })
  ))
  const ids = pages.flatMap(result => result.posts.map(post => post.id))

  expect(pages.map(result => result.page)).toEqual([1, 2, 3])
  expect(pages.map(result => result.posts.length)).toEqual([20, 20, 1])
  expect(new Set(ids).size).toBe(41)
  expect(ids).toEqual(Array.from({ length: 41 }, (_, index) => 41 - index))
})

test('All unread navigation resolves cursor page numbers without a full snapshot', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'reader','reader@example.test','x'),(2,'writer','writer@example.test','x')`)
  const insert = database.query('INSERT INTO posts(id,user_id,body,created_at) VALUES(?,2,?,?)')
  for (let id = 1; id <= 21; id++) insert.run(id, `post ${id}`, `2026-09-01 10:${id}:00`)
  cacheDb.query('DELETE FROM global_feed_page_cursors WHERE kind=\'latest\' AND viewer_id=1').run()

  const preview = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
    markRead: false,
  })
  expect(preview.lastUnreadHref).toBe('/all?page=2#post-1')

  const readFirstPage = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 1,
    pageSize: 20,
  })
  expect(readFirstPage.unreadHref).toBe('/all?page=2#post-1')
})

test('numbered New pages seek through equal timestamps by post id', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'writer\',\'writer@example.test\',\'x\')')
  const insert = database.query(
    'INSERT INTO posts(id,user_id,body,created_at) VALUES(?,1,?,\'2026-09-01 10:00:00\')',
  )
  for (let id = 1; id <= 41; id++) insert.run(id, `post ${id}`)
  cacheDb.query('DELETE FROM global_feed_page_cursors WHERE kind=\'new\' AND viewer_id=-122').run()

  const pages = []
  for (const page of [1, 2, 3]) {
    pages.push(await executeDatabaseDomain(database, 'feeds.newPage', {
      viewerId: -122,
      page,
      pageSize: 20,
    }))
  }
  const ids = pages.flatMap(result => result.posts.map(post => post.id))

  expect(pages.map(result => result.posts.length)).toEqual([20, 20, 1])
  expect(new Set(ids).size).toBe(41)
  expect(ids).toEqual(Array.from({ length: 41 }, (_, index) => 41 - index))
})

test('viewer block changes invalidate cached global feed boundaries', async () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'viewer','viewer@example.test','x'),(2,'old','old@example.test','x'),
    (3,'middle','middle@example.test','x'),(4,'newest','newest@example.test','x');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
    (10,2,'old','2026-09-01'),(20,3,'middle','2026-09-02'),(30,4,'newest','2026-09-03');`)
  cacheDb.query('DELETE FROM global_feed_page_cursors WHERE viewer_id=1').run()
  const before = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 2,
    pageSize: 1 as 20,
    markRead: false,
  })
  expect(before.posts.map(post => post.id)).toEqual([20])

  await executeDatabaseDomain(database, 'api.relationshipMutation', {
    userId: 1,
    handle: 'newest',
    action: 'block',
  })
  expect(cacheDb.query('SELECT 1 FROM global_feed_page_cursors WHERE viewer_id=1').get()).toBeNull()
  const after = await executeDatabaseDomain(database, 'feeds.latestPage', {
    viewerId: 1,
    page: 2,
    pageSize: 1 as 20,
    markRead: false,
  })
  expect(after.posts.map(post => post.id)).toEqual([10])
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
