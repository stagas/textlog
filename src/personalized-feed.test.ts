import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { apiActivities } from './api-activity'
import { markLatestPostsRead } from './latest-state'
import { runMigrations } from './migrations'
import { loadPersonalizedFeed, personalizedUnreadCount } from './personalized-feed'
import type { User } from './types'

test('moderators see blocked-user leaf posts in For You with relationship metadata', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'admin','gstagas@gmail.com','!',''),
      (2,'blocker','blocker@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-03 08:00:00');
    INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,1);
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,2,NULL,'moderator-visible leaf','2026-08-03 09:00:00');`)
  const admin: User = { id: 1, handle: 'admin', email: 'gstagas@gmail.com', bio: '' }

  const feed = loadPersonalizedFeed(database, admin, 1, 20, false, '/for-you', false)

  expect(feed.timeline.map(row => row.id)).toContain(1)
  expect(feed.timeline.find(row => row.id === 1)?.renderedPost?.blocked_viewer).toBeTrue()
})

test('For You preserves moderation warnings in rendered posts', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'followed','followed@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-03 08:00:00');
    INSERT INTO posts(id,user_id,body,created_at,moderation_category,moderation_score) VALUES
      (1,2,'moderated post','2026-08-03 09:00:00','self-harm/intent',0.42);`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  const post = feed.timeline.find(row => row.id === 1)?.renderedPost

  expect(post?.moderation_category).toBe('self-harm/intent')
  expect(post?.moderation_score).toBe(0.42)
})

test('For You consumes overlapping directed posts from Latest before rendering its counter', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'writer','writer@example.com','!','');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'viewer root','2026-08-03 09:00:00'),
      (2,2,1,'directed reply','2026-08-03 10:00:00');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you')

  expect(feed.timeline.find(row => row.id === 2)?.targeted_to_viewer).toBeTruthy()
  expect(feed.latestCount).toBe(0)
})

test('whisper descendants stay in participant and original tag-follower personalized feeds', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'alice','alice@example.com','!',''),
      (2,'bob','bob@example.com','!',''),
      (3,'charlie','charlie@example.com','!',''),
      (4,'dave','dave@example.com','!','');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,4,NULL,'public root','2026-08-03 09:00:00'),
      (2,1,1,'ordinary reply','2026-08-03 10:00:00'),
      (3,2,2,'start #whisper #topic','2026-08-03 11:00:00');
    UPDATE posts SET translation='translated whisper' WHERE id=3;
    INSERT INTO post_hashtags(post_id,tag) VALUES(3,'whisper'),(3,'topic');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(3,'topic','2026-08-03 10:30:00');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(4,2,'2026-08-03 10:30:00');`)
  const generation = (userId: number) =>
    (database.query(
      'SELECT generation FROM personalized_feed_generations WHERE viewer_id=?',
    ).get(userId) as { generation: number }).generation
  const aliceGeneration = generation(1)
  const charlieGeneration = generation(3)
  database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at)
    VALUES(4,2,3,'untagged continuation','2026-08-03 12:00:00')`)
  const alice: User = { id: 1, handle: 'alice', email: 'alice@example.com', bio: '' }
  const charlie: User = { id: 3, handle: 'charlie', email: 'charlie@example.com', bio: '' }
  const dave: User = { id: 4, handle: 'dave', email: 'dave@example.com', bio: '' }

  const aliceToMe = loadPersonalizedFeed(database, alice, 1, 20, true, '/to-me', false)
  const charlieForYou = loadPersonalizedFeed(database, charlie, 1, 20, false, '/for-you', false)
  const charlieToMe = loadPersonalizedFeed(database, charlie, 1, 20, true, '/to-me', false)
  const daveForYou = loadPersonalizedFeed(database, dave, 1, 20, false, '/for-you', false)
  const daveToMe = loadPersonalizedFeed(database, dave, 1, 20, true, '/to-me', false)

  expect(generation(1)).toBeGreaterThan(aliceGeneration)
  expect(generation(3)).toBeGreaterThan(charlieGeneration)
  expect(aliceToMe.timeline.filter(row => row.id).map(row => row.id)).toEqual([4, 3])
  expect(charlieForYou.timeline.filter(row => row.id).map(row => row.id)).toEqual([4, 3])
  expect(charlieForYou.timeline.find(row => row.id === 3)?.renderedPost?.translation).toBe('translated whisper')
  expect(charlieToMe.timeline.some(row => row.id === 4)).toBeFalse()
  expect(daveForYou.timeline.some(row => row.id === 4)).toBeFalse()
  expect(daveToMe.timeline.some(row => row.id === 4)).toBeFalse()
})

test('a recent deep reply in a followed thread stays included after Latest marks it read', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'followed','followed@example.com','!',''),
      (3,'middle','middle@example.com','!',''),
      (4,'replier','replier@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-03 08:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,2,NULL,'root','2026-08-03 09:00:00'),
      (2,3,1,'middle','2026-08-03 10:00:00');`)
  markLatestPostsRead(1, [1, 2], database)
  database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at)
    VALUES(3,4,2,'deep reply','2026-08-03 11:00:00')`)
  markLatestPostsRead(1, [3], database)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const badgeCount = personalizedUnreadCount(database, viewer.id, false)

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([1, 3, 2])
  expect(feed.timeline.find(row => row.id === 3)?.unread).toBe(1)
  expect(badgeCount).toBe(feed.forYouCount)
})

test('personalized pages count conversations rather than their embedded replies', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'followed','followed@example.com','!',''),
      (3,'replier','replier@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-03 08:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,2,NULL,'first root','2026-08-03 09:00:00'),
      (2,3,1,'first reply','2026-08-03 10:00:00'),
      (3,3,2,'second reply','2026-08-03 11:00:00'),
      (4,2,NULL,'second root','2026-08-03 12:00:00');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const firstPage = loadPersonalizedFeed(database, viewer, 1, 1, false, '/for-you', false)
  const secondPage = loadPersonalizedFeed(database, viewer, 2, 1, false, '/for-you', false)

  expect(firstPage.totalPages).toBe(2)
  expect(firstPage.timeline.map(row => row.id)).toEqual([4])
  expect(secondPage.timeline.map(row => row.id)).toEqual([1, 3, 2])
})

test('To Me conversations are ordered by their latest directed activity', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'first','first@example.com','!',''),
      (3,'second','second@example.com','!','');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'old root','2026-08-24 10:00:00'),
      (2,2,1,'old directed reply','2026-08-24 11:00:00'),
      (3,2,2,'recent reply not directed to viewer','2026-08-27 12:00:00'),
      (4,1,NULL,'new root','2026-08-26 10:00:00'),
      (5,3,4,'new directed reply','2026-08-26 11:00:00');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, true, '/to-me', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([5, 2])
})

test('To Me interleaves directed activity chronologically instead of grouping conversations', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'first','first@example.com','!',''),
      (3,'second','second@example.com','!','');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'first root','2026-08-24 09:00:00'),
      (2,2,1,'older reply','2026-08-24 10:00:00'),
      (3,1,NULL,'second root','2026-08-24 09:30:00'),
      (4,3,3,'middle reply','2026-08-24 11:00:00'),
      (5,2,1,'newest reply','2026-08-24 12:00:00');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, true, '/@', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([5, 4, 2])
})

test('For You includes unread replies beyond the recent reply preview', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'followed','followed@example.com','!',''),
      (3,'replier','replier@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-01 08:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (895,2,NULL,'root','2026-08-11 09:41:26'),
      (922,3,895,'old reply','2026-08-11 14:41:06'),
      (2599,3,895,'recent one','2026-08-26 22:03:54'),
      (2600,3,895,'recent two','2026-08-26 22:07:23'),
      (2602,3,895,'recent three','2026-08-26 22:10:21'),
      (2607,3,895,'recent four','2026-08-26 23:28:22');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([895, 2607, 2602, 2600, 2599, 922])
  expect(feed.timeline.find(row => row.id === 922)?.unread).toBe(1)
})

test('My Feed keeps five replies for expansion after rebuilding its read snapshot', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'followed','followed@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-01 08:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1495,2,NULL,'root','2026-08-16 14:10:58'),
      (2904,2,1495,'older recent direct','2026-08-30 13:20:03'),
      (2953,2,1495,'newer recent direct','2026-08-31 15:42:10'),
      (2954,2,2953,'deep intermediate one','2026-08-31 15:47:09'),
      (2955,2,2954,'deep intermediate two','2026-08-31 15:53:24'),
      (2956,2,2955,'newest deep reply','2026-08-31 15:54:59');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const unread = loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed')
  expect(unread.timeline.filter(row => row.id).map(row => row.id))
    .toEqual([1495, 2956, 2955, 2954, 2953, 2904])

  const read = loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed', false)
  expect(read.timeline.filter(row => row.id).map(row => row.id))
    .toEqual([1495, 2956, 2955, 2954, 2953, 2904])
  expect(read.timeline.find(row => row.id === 2956)?.renderedPost?.feed_collapsed_preview).toBeUndefined()
  expect(read.timeline.find(row => row.id === 2953)?.renderedPost?.feed_collapsed_preview).toBeTrue()
  expect(read.timeline.find(row => row.id === 2904)?.renderedPost?.feed_collapsed_preview).toBeTrue()
})

test('My Feed keeps post 2958 direct reply 2961 as the weighted preview anchor', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'stagas','stagas@example.com','!',''),
      (2,'evnm','evnm@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-08-01 08:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (2958,2,NULL,'root','2026-08-31 18:53:23'),
      (2961,1,2958,'direct reply','2026-08-31 19:54:48'),
      (2962,2,2961,'deep one','2026-08-31 19:55:17'),
      (2963,1,2962,'deep two','2026-08-31 19:57:35'),
      (2964,2,2963,'deep three','2026-08-31 19:58:44'),
      (2965,1,2964,'latest reply','2026-08-31 20:00:49');`)
  const viewer: User = { id: 1, handle: 'stagas', email: 'stagas@example.com', bio: '' }

  loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed')
  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id))
    .toEqual([2958, 2965, 2964, 2963, 2962, 2961])
  expect(feed.timeline.find(row => row.id === 2965)?.renderedPost?.feed_collapsed_preview).toBeTrue()
  expect(feed.timeline.find(row => row.id === 2961)?.renderedPost?.feed_collapsed_preview).toBeTrue()
  for (const id of [2962, 2963, 2964]) {
    expect(feed.timeline.find(row => row.id === id)?.renderedPost?.feed_collapsed_preview).toBeUndefined()
  }
})

test('For You keeps expandable parent context using the same two-to-five reply rule as Latest', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'root','root@example.com','!',''),
      (3,'replier','replier@example.com','!',''),
      (4,'older','older@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (1,2,'2026-08-01 00:00:00'),(1,3,'2026-08-01 00:00:00'),(1,4,'2026-08-01 00:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (370,2,NULL,'root','2026-08-08 02:32:30'),
      (2370,4,370,'older reply','2026-08-25 03:11:23'),
      (2829,1,370,'viewer parent','2026-08-29 10:49:12'),
      (2833,3,2829,'nested reply','2026-08-29 11:22:11'),
      (2834,3,370,'direct sibling','2026-08-29 11:25:06');
    INSERT INTO for_you_reads(user_id,event_key) VALUES
      (1,'post:00000000000000000370'),(1,'post:00000000000000002370'),
      (1,'post:00000000000000002829'),(1,'post:00000000000000002833'),
      (1,'post:00000000000000002834');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([370, 2834, 2833, 2829, 2370])
  expect(feed.timeline.find(row => row.id === 2833)?.parent_id).toBe(2829)
})

test('For You groups fresh sibling branches under the same shared parent as All', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'root','root@example.com','!',''),
      (3,'branch','branch@example.com','!',''),
      (4,'reply','reply@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (1,2,'2026-08-01 00:00:00'),(1,3,'2026-08-01 00:00:00'),(1,4,'2026-08-01 00:00:00');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,2,NULL,'old root','2026-08-01 09:00:00'),
      (2,3,1,'shared parent','2026-08-02 09:00:00'),
      (3,3,2,'first branch','2026-08-03 09:00:00'),
      (4,3,2,'second branch','2026-08-03 10:00:00'),
      (5,4,3,'newest reply','2026-08-30 12:00:00'),
      (6,4,4,'fresh sibling reply','2026-08-30 11:00:00');
    INSERT INTO for_you_reads(user_id,event_key) VALUES
      (1,'post:00000000000000000001'),(1,'post:00000000000000000002'),
      (1,'post:00000000000000000003'),(1,'post:00000000000000000004');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/my-feed', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([5, 6, 2])
})

test('For You follow activity can be hidden independently for people and hashtags', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'friend','friend@example.com','!',''),
      (3,'person','person@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (1,2,'2026-08-03 09:00:00'),(2,3,'2026-08-03 10:00:00'),(3,1,'2026-08-03 12:00:00');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(2,'topic','2026-08-03 11:00:00');
    UPDATE users SET hide_people_follow_activity=1,hide_hashtag_follow_activity=0 WHERE id=1;`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '', hide_people_follow_activity: 1 }

  const peopleHidden = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  expect(peopleHidden.timeline.map(row => row.activity_kind)).toEqual(['tag_follow'])
  expect(peopleHidden.forYouCount).toBe(1)
  expect(peopleHidden.unreadHref).toBeDefined()
  const directedFollow = loadPersonalizedFeed(database, viewer, 1, 20, true, '/to-me', false)
  expect(directedFollow.timeline.map(row => row.activity_kind)).toEqual(['user_follow'])

  database.query('UPDATE personalized_feed_generations SET generation=generation+1 WHERE viewer_id=1').run()
  database.query('UPDATE users SET hide_people_follow_activity=0,hide_hashtag_follow_activity=1 WHERE id=1').run()
  viewer.hide_people_follow_activity = 0
  viewer.hide_hashtag_follow_activity = 1
  const hashtagsHidden = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  expect(hashtagsHidden.timeline).toHaveLength(2)
  expect(hashtagsHidden.timeline.every(row => row.activity_kind === 'user_follow')).toBeTrue()
  expect(hashtagsHidden.forYouCount).toBe(2)
})

test('unread count refreshes while relationship invalidation remains pending', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio,hide_people_follow_activity) VALUES
      (1,'viewer','viewer@example.com','!','',0),
      (2,'friend','friend@example.com','!','',0),
      (3,'first','first@example.com','!','',0),
      (4,'second','second@example.com','!','',0);
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (1,2,'2026-08-03 09:00:00'),(2,3,'2026-08-03 10:00:00');`)

  expect(personalizedUnreadCount(database, 1, false)).toBe(1)

  // The pending-invalidation row already exists, so this change does not alter the old memoization key.
  database.query(`INSERT INTO follows(follower_id,following_id,created_at)
    VALUES(2,4,'2026-08-03 11:00:00')`).run()

  expect(personalizedUnreadCount(database, 1, false)).toBe(2)
})

test('personalized snapshots refresh follow state for To Me and For You actions', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'actor','actor@example.com','!',''),
      (3,'target','target@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (2,1,'2026-08-27 09:00:00');`)
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const toMeBefore = loadPersonalizedFeed(database, viewer, 1, 20, true, '/to-me', false)
  expect(toMeBefore.timeline.find(row => row.actor_id === 2)?.following).toBeFalse()

  database.run(`INSERT INTO follows(follower_id,following_id,created_at) VALUES
    (1,2,'2026-08-27 09:30:00'),(2,3,'2026-08-27 10:00:00');`)
  const toMeAfter = loadPersonalizedFeed(database, viewer, 1, 20, true, '/to-me', false)
  const forYouBefore = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  expect(toMeAfter.timeline.find(row => row.actor_id === 2)?.following).toBeTrue()
  expect(forYouBefore.timeline.find(row => row.target_handle === 'target')?.following).toBeFalse()

  database.query(`INSERT INTO follows(follower_id,following_id,created_at)
    VALUES(1,3,'2026-08-27 11:00:00')`).run()
  const forYouAfter = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  expect(forYouAfter.timeline.find(row => row.target_handle === 'target')?.following).toBeTrue()
})

test('For You only includes activity created after following a person or hashtag', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,bio) VALUES
      (1,'viewer','viewer@example.com','!',''),
      (2,'friend','friend@example.com','!',''),
      (3,'tagger','tagger@example.com','!',''),
      (4,'target','target@example.com','!','');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES
      (1,2,'2026-08-03 10:00:00'),
      (2,3,'2026-08-03 09:00:00'),
      (2,4,'2026-08-03 11:00:00');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES
      (1,'topic','2026-08-03 10:00:00'),
      (3,'topic','2026-08-03 09:00:00'),
      (4,'topic','2026-08-03 11:00:00');
    INSERT INTO posts(id,user_id,body,created_at) VALUES
      (1,2,'old person note','2026-08-03 09:00:00'),
      (2,2,'new person note','2026-08-03 11:00:00'),
      (3,3,'old #topic note','2026-08-03 09:00:00'),
      (4,3,'new #topic note','2026-08-03 11:00:00');
    INSERT INTO post_hashtags(post_id,tag) VALUES(3,'topic'),(4,'topic');`)
  database.query(`UPDATE users SET hide_people_follow_activity=0,hide_hashtag_follow_activity=0 WHERE id=1`).run()
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '' }

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id).sort()).toEqual([2, 4])
  expect(feed.timeline.filter(row => row.activity_kind === 'user_follow').map(row => row.target_handle))
    .toEqual(['target'])
  expect(feed.timeline.filter(row => row.activity_kind === 'tag_follow').map(row => row.actor_handle))
    .toEqual(['target'])
  expect(feed.forYouCount).toBe(4)

  const api = apiActivities(database, 'https://textlog.test', viewer, { limit: 20, cursor: null, toMe: false })
  expect(api.data.flatMap(activity =>
    activity.type === 'post' && 'id' in activity.payload
      ? [activity.payload.id]
      : []
  ).sort())
    .toEqual([2, 4])
})
