import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { runMigrations } from './migrations'
import { apiActivities } from './api-activity'
import { loadPersonalizedFeed } from './personalized-feed'
import { markLatestPostsRead } from './latest-state'
import type { User } from './types'

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
  const generation = (userId: number) => (database.query(
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

  const feed = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)

  expect(feed.timeline.filter(row => row.id).map(row => row.id)).toEqual([3, 2])
  expect(feed.timeline.find(row => row.id === 3)?.unread).toBe(1)
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
  expect(secondPage.timeline.map(row => row.id)).toEqual([3, 2])
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
  const viewer: User = { id: 1, handle: 'viewer', email: 'viewer@example.com', bio: '',
    hide_people_follow_activity: 1 }

  const peopleHidden = loadPersonalizedFeed(database, viewer, 1, 20, false, '/for-you', false)
  expect(peopleHidden.timeline.map(row => row.activity_kind)).toEqual(['user_follow', 'tag_follow'])
  expect(peopleHidden.forYouCount).toBe(2)
  expect(peopleHidden.unreadHref).toBeDefined()
  expect(Number(peopleHidden.timeline[0]?.target_is_viewer)).toBe(1)
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

  const api = apiActivities(database, 'https://textlog.test', viewer,
    { limit: 20, cursor: null, toMe: false })
  expect(api.data.flatMap(activity => activity.type === 'post' && 'id' in activity.payload
    ? [activity.payload.id]
    : []).sort())
    .toEqual([2, 4])
})
