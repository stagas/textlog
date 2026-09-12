import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { markPersonalizedFeedThrough, materializedPersonalizedEventPage, materializedPersonalizedGroupPage,
  personalizedFeedState } from './feed-state'
import { claimInitialHandle, dropUsername } from './handles'
import { migrations, runMigrations } from './migrations'

test('materialized post reasons deduplicate and feed state advances through represented entries', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,hide_people_follow_activity) VALUES
      (1,'viewer','viewer@example.com','!',0),(2,'author','author@example.com','!',1);
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'bun','2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'hello #bun','2026-01-02');
    INSERT INTO post_hashtags(post_id,tag) VALUES(10,'bun');
    INSERT INTO post_mentions(post_id,user_id) VALUES(10,1);`)

  const entries = database.query(`SELECT sequence,feed,reason FROM personalized_feed_entries
    WHERE viewer_id=1 AND source_post_id=10 ORDER BY feed`).all() as Array<{
    sequence: number
    feed: string
    reason: number
  }>
  expect(entries).toHaveLength(2)
  expect(entries.find(entry => entry.feed === 'for-you')!.reason & (2 | 4 | 8)).toBe(2 | 4 | 8)
  expect(entries.find(entry => entry.feed === 'to-me')!.reason & 8).toBe(8)
  const represented = entries.find(entry => entry.feed === 'for-you')!.sequence
  markPersonalizedFeedThrough(database, 1, 'for-you', represented)
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)
})

test('blocking people and tags removes existing materialized entries and repairs state', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,hide_people_follow_activity) VALUES
      (1,'viewer','viewer@example.com','!',0),(2,'author','author@example.com','!',1);
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'hello','2026-01-02');`)
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
  database.run('INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,2)')
  expect(database.query('SELECT 1 FROM personalized_feed_entries WHERE viewer_id=1').get()).toBeNull()
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({ latest_sequence: 0, unread_count: 0 })
})

test('personalized page query uses the viewer/feed sequence index', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  const plan = database.query(`EXPLAIN QUERY PLAN SELECT source_post_id FROM personalized_feed_entries
    WHERE viewer_id=? AND feed=? AND sequence<? ORDER BY sequence DESC LIMIT ?`).all(1, 'for-you', 100, 20) as Array<
    { detail: string }
  >
  expect(plan.some(row => row.detail.includes('personalized_feed_entries_page'))).toBeTrue()
})

test('feed badges and global cursors retain indexed query plans', () => {
  const database = new Database(':memory:')
  runMigrations(database)
  const badge = database.query(`EXPLAIN QUERY PLAN SELECT unread_count FROM feed_state
    WHERE viewer_id=? AND feed=?`).all(1, 'for-you') as Array<{ detail: string }>
  const latest = database.query(`EXPLAIN QUERY PLAN SELECT conversation_id FROM conversation_heads
    WHERE latest_post_id<? ORDER BY latest_post_id DESC,conversation_id DESC LIMIT ?`).all(100, 20) as Array<{
    detail: string
  }>
  const fresh = database.query(`EXPLAIN QUERY PLAN SELECT id FROM posts
    WHERE parent_id IS NULL AND (created_at<? OR (created_at=? AND id<?))
    ORDER BY created_at DESC,id DESC LIMIT ?`).all('2026-01-01', '2026-01-01', 100, 20) as Array<{
    detail: string
  }>
  const unread = database.query(`EXPLAIN QUERY PLAN SELECT id FROM posts
    WHERE id>? ORDER BY id DESC LIMIT 1`).all(100) as Array<{ detail: string }>

  expect(badge.some(row => row.detail.includes('PRIMARY KEY (viewer_id=? AND feed=?)'))).toBeTrue()
  expect(latest.some(row => row.detail.includes('conversation_heads_latest'))).toBeTrue()
  expect(fresh.some(row => row.detail.includes('posts_parent'))).toBeTrue()
  expect(unread.some(row => row.detail.includes('INTEGER PRIMARY KEY (rowid>?)'))).toBeTrue()
})

test('relationship activity is materialized for For You and To Me without duplicates', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'actor','actor@example.com','!'),
      (3,'target','target@example.com','!');
    UPDATE users SET hide_people_follow_activity=0,hide_hashtag_follow_activity=0;
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(2,3,'2026-01-02');`)
  expect(database.query(`SELECT feed,event_kind,actor_id,target_user_id FROM personalized_feed_entries
    WHERE viewer_id=1 AND event_kind='user_follow'`).all()).toEqual([
    { feed: 'for-you', event_kind: 'user_follow', actor_id: 2, target_user_id: 3 },
  ])
  expect(database.query(`SELECT feed FROM personalized_feed_entries WHERE viewer_id=3
    AND event_kind='user_follow' ORDER BY feed`).all()).toEqual([{ feed: 'for-you' }, { feed: 'to-me' }])
  database.run(`INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'bun','2026-01-01');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(2,'bun','2026-01-03');`)
  expect(database.query(`SELECT count(*) count FROM personalized_feed_entries WHERE viewer_id=1
    AND event_kind='tag_follow'`).get()).toEqual({ count: 1 })
})

test('numbered materialized pages use stable keyset boundaries across concurrent inserts', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'viewer\',\'viewer@example.com\',\'!\')')
  const insert = database.query(`INSERT INTO personalized_feed_entries(
    viewer_id,feed,event_key,event_kind,actor_id,reason,created_at) VALUES(1,'for-you',?,'signup',1,0,?)`)
  for (let id = 1; id <= 5; id++) insert.run(`signup:${id}`, `2026-01-0${id}`)
  const first = materializedPersonalizedEventPage(database, 1, 'for-you', 1, 2, 7)
  expect(first.entries.map(entry => entry.event_key)).toEqual(['signup:5', 'signup:4'])
  insert.run('signup:6', '2026-01-06')
  const second = materializedPersonalizedEventPage(database, 1, 'for-you', 2, 2, 7)
  expect(second.entries.map(entry => entry.event_key)).toEqual(['signup:3', 'signup:2'])
  expect(new Set([...first.entries, ...second.entries].map(entry => entry.event_key)).size).toBe(4)
})

test('watermark advancement and repairs retain scattered legacy read exceptions', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'viewer\',\'viewer@example.com\',\'!\')')
  const insert = database.query(`INSERT INTO personalized_feed_entries(
    viewer_id,feed,event_key,event_kind,actor_id,reason,created_at)
    VALUES(1,'for-you',?,'signup',1,0,?) RETURNING sequence`)
  const sequences = []
  for (let id = 1; id <= 4; id++) {
    sequences.push((insert.get(`signup:${id}`, `2026-01-0${id}`) as { sequence: number }).sequence)
  }
  database.run('INSERT INTO for_you_reads(user_id,event_key) VALUES(1,\'signup:4\')')

  markPersonalizedFeedThrough(database, 1, 'for-you', sequences[0])
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({
    last_seen_sequence: sequences[0],
    unread_count: 2,
  })
  database.run('DELETE FROM personalized_feed_entries WHERE viewer_id=1 AND event_key=\'signup:2\'')
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
})

test('a self-authored root is visible but always read', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'other','other@example.com','!');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'root','2026-01-01');`)
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)
  expect(database.query(`SELECT entry.eligible,seen.event_key IS NOT NULL seen FROM personalized_feed_entries entry
    LEFT JOIN for_you_reads seen ON seen.user_id=entry.viewer_id AND seen.event_key=entry.event_key
    WHERE entry.viewer_id=1 AND entry.source_post_id=10`).get()).toEqual({ eligible: 1, seen: 1 })
})

test('an administrator self-post is visible but never increments My Feed', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'admin','gstagas@gmail.com','!'),(2,'other','other@example.com','!');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'idle root','2026-01-01');`)

  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=10`).get()).toEqual({ reason: 1, eligible: 1 })
  const idle = materializedPersonalizedGroupPage(database, 1, 'for-you', 1, 20, 1)
  expect(idle.groups).toEqual(['conversation:00000000000000000010'])
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)
})

test('a self-authored reply is visible and read without affecting the badge', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'other','other@example.com','!');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'other root','2026-01-01');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(11,1,10,'my reply','2026-01-02');`)
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ eligible: 1 })
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)
})

test('the upgrade repair restores historical self posts as visible read entries', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'viewer','viewer@example.com','!');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'first idle root','2026-01-01');
    UPDATE personalized_feed_entries SET eligible=0 WHERE viewer_id=1 AND source_post_id=10;
    DELETE FROM for_you_reads WHERE user_id=1;`)
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND source_post_id=10`).get()).toEqual({ eligible: 0 })
  migrations.find(migration => migration.version === 222)!.up(database)
  expect(database.query(`SELECT entry.eligible,seen.event_key IS NOT NULL seen
    FROM personalized_feed_entries entry LEFT JOIN for_you_reads seen
      ON seen.user_id=entry.viewer_id AND seen.event_key=entry.event_key
    WHERE entry.viewer_id=1 AND entry.source_post_id=10`).get()).toEqual({ eligible: 1, seen: 1 })
})

test('the upgrade repair rekeys directed replies to their real conversation', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`DROP TRIGGER materialized_feed_group_conversation;
    INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,1,'root','2026-01-01');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(11,2,10,'reply','2026-01-02');`)
  expect(database.query(`SELECT group_key FROM personalized_feed_groups
    WHERE viewer_id=1 AND feed='to-me'`).get()).toEqual({ group_key: 'conversation:00000000000000000011' })

  migrations.find(migration => migration.version === 221)!.up(database)
  expect(database.query(`SELECT group_key FROM personalized_feed_groups
    WHERE viewer_id=1 AND feed='to-me'`).get()).toEqual({ group_key: 'conversation:00000000000000000010' })
  const page = materializedPersonalizedGroupPage(database, 1, 'to-me', 1, 20, 1)
  expect(page.groups).toEqual(['conversation:00000000000000000010'])
})

test('muted descendants stay out of materialized unread state except for explicit mentions', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'root','2026-01-02');`)
  markPersonalizedFeedThrough(database, 1, 'for-you', personalizedFeedState(database, 1, 'for-you')!.latest_sequence)
  database.run(`INSERT INTO muted_posts(user_id,post_id) VALUES(1,10);
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(11,2,10,'quiet reply','2026-01-03');`)

  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ eligible: 0 })
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)

  database.run('INSERT INTO post_mentions(post_id,user_id) VALUES(11,1)')
  expect(database.query(`SELECT feed,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND source_post_id=11 ORDER BY feed`).all()).toEqual([
    { feed: 'for-you', eligible: 1 },
    { feed: 'to-me', eligible: 1 },
  ])
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
  expect(personalizedFeedState(database, 1, 'to-me')?.unread_count).toBe(1)

  database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at)
    VALUES(12,2,10,'another quiet reply','2026-01-04')`)
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=12`).get()).toEqual({ eligible: 0 })
  database.run('DELETE FROM muted_posts WHERE user_id=1 AND post_id=10')
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=12`).get()).toEqual({ eligible: 1 })
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
})

test('soft deletion and restoration repair materialized membership and feed state', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'post','2026-01-02');`)
  const entry = database.query(`SELECT sequence,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=10`).get() as {
    sequence: number
    eligible: number
  }
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({
    latest_sequence: entry.sequence,
    unread_count: 1,
  })

  database.run('UPDATE posts SET deleted_at=\'2026-01-03\' WHERE id=10')
  expect(database.query('SELECT eligible FROM personalized_feed_entries WHERE sequence=?').get(entry.sequence))
    .toEqual({ eligible: 0 })
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({ latest_sequence: 0, unread_count: 0 })
  expect(database.query(`SELECT 1 FROM personalized_feed_groups
    WHERE viewer_id=1 AND feed='for-you'`).get()).toBeNull()

  database.run('UPDATE posts SET deleted_at=NULL WHERE id=10')
  expect(database.query('SELECT eligible FROM personalized_feed_entries WHERE sequence=?').get(entry.sequence))
    .toEqual({ eligible: 1 })
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({
    latest_sequence: entry.sequence,
    unread_count: 1,
  })
  expect(database.query(`SELECT 1 FROM personalized_feed_groups
    WHERE viewer_id=1 AND feed='for-you'`).get()).toBeTruthy()
})

test('account suspension and restoration repair materialized activity state', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'post','2026-01-02');`)
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)

  database.run('UPDATE users SET suspended_at=\'2026-01-03\' WHERE id=2')
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND source_post_id=10`).get()).toEqual({ eligible: 0 })
  expect(personalizedFeedState(database, 1, 'for-you')).toMatchObject({ latest_sequence: 0, unread_count: 0 })

  database.run('UPDATE users SET suspended_at=NULL WHERE id=2')
  expect(database.query(`SELECT eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND source_post_id=10`).get()).toEqual({ eligible: 1 })
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
})

test('relationship and post-tag removals recompute overlapping materialized reasons', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'bun','2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'#bun','2026-01-02');
    INSERT INTO post_hashtags(post_id,tag) VALUES(10,'bun');`)
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=10`).get()).toEqual({ reason: 6, eligible: 1 })

  database.run('DELETE FROM follows WHERE follower_id=1 AND following_id=2')
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=10`).get()).toEqual({ reason: 4, eligible: 1 })
  database.run('DELETE FROM hashtag_follows WHERE user_id=1 AND tag=\'bun\'')
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=10`).get()).toEqual({ reason: 0, eligible: 0 })

  database.run(`INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(1,'bun','2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(11,2,'#bun again','2026-01-03');
    INSERT INTO post_hashtags(post_id,tag) VALUES(11,'bun');`)
  expect(database.query(`SELECT reason FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ reason: 4 })
  database.run('DELETE FROM post_hashtags WHERE post_id=11 AND tag=\'bun\'')
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ reason: 0, eligible: 0 })
  database.run('INSERT INTO post_hashtags(post_id,tag) VALUES(11,\'bun\')')
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ reason: 4, eligible: 1 })
})

test('conversation ancestry is represented in the post reason bitmask', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'root','root@example.com','!'),
      (3,'replier','replier@example.com','!');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'root','2026-01-02');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(11,3,10,'reply','2026-01-03');`)
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ reason: 64, eligible: 1 })
  database.run('DELETE FROM follows WHERE follower_id=1 AND following_id=2')
  expect(database.query(`SELECT reason,eligible FROM personalized_feed_entries
    WHERE viewer_id=1 AND feed='for-you' AND source_post_id=11`).get()).toEqual({ reason: 0, eligible: 0 })
})

test('handle completion materializes signup activity for administrators', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,handle_chosen_at) VALUES
      (1,'admin','gstagas@gmail.com','!',CURRENT_TIMESTAMP),
      (2,'pending','new@example.com','!',NULL);
    UPDATE users SET handle='newcomer',handle_chosen_at='2026-01-02' WHERE id=2;`)

  expect(database.query(`SELECT viewer_id,feed,event_kind,actor_id,eligible
    FROM personalized_feed_entries WHERE event_kind='signup'`).all()).toEqual([
    { viewer_id: 1, feed: 'for-you', event_kind: 'signup', actor_id: 2, eligible: 1 },
  ])
  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(1)
})

test('choosing a replacement for a dropped username does not duplicate signup activity', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,handle_chosen_at) VALUES
      (1,'admin','gstagas@gmail.com','!',CURRENT_TIMESTAMP),
      (2,'pending','new@example.com','!',NULL);
    UPDATE users SET handle='newcomer',handle_chosen_at='2026-01-02' WHERE id=2;`)

  expect(database.query(`SELECT count(*) count FROM personalized_feed_entries
    WHERE event_kind='signup' AND actor_id=2`).get()).toEqual({ count: 1 })

  dropUsername(database, 2, 1, 'rename required')
  claimInitialHandle(database, 2, 'renamed')

  expect(database.query(`SELECT count(*) count FROM personalized_feed_entries
    WHERE event_kind='signup' AND actor_id=2`).get()).toEqual({ count: 1 })
})

test('re-materializing historical read entries does not resurrect unread counters', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'viewer','viewer@example.com','!'),(2,'author','author@example.com','!');
    INSERT INTO for_you_reads(user_id,event_key) VALUES(1,'post:00000000000000000010');
    INSERT INTO to_me_reads(user_id,event_key) VALUES(1,'post:00000000000000000010');
    INSERT INTO personalized_feed_entries(viewer_id,feed,event_key,event_kind,actor_id,reason,created_at)
      VALUES(1,'for-you','post:00000000000000000010','post',2,2,'2026-01-02'),
        (1,'to-me','post:00000000000000000010','reply',2,16,'2026-01-02');`)

  expect(personalizedFeedState(database, 1, 'for-you')?.unread_count).toBe(0)
  expect(personalizedFeedState(database, 1, 'to-me')?.unread_count).toBe(0)
})

test('hidden follow activity does not consume personalized page slots', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,hide_people_follow_activity) VALUES
      (1,'viewer','viewer@example.com','!',1),(2,'author','author@example.com','!',0);
    INSERT INTO personalized_feed_entries(viewer_id,feed,event_key,event_kind,actor_id,reason,created_at)
      VALUES(1,'for-you','post:00000000000000000010','post',2,2,'2026-01-02'),
        (1,'for-you','user-follow:hidden','user_follow',2,0,'2026-01-03');`)

  const page = materializedPersonalizedGroupPage(database, 1, 'for-you', 1, 1, 1)
  expect(page.groups).toEqual(['post:00000000000000000010'])
  expect(page.totalItems).toBe(1)
})

test('materialized group pages keep conversation posts in one cursor position', () => {
  const database = new Database(':memory:', { strict: true })
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password,hide_people_follow_activity) VALUES
      (1,'viewer','viewer@example.com','!',0),(2,'author','author@example.com','!',1);
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(1,2,'2026-01-01');
    INSERT INTO posts(id,user_id,body,created_at) VALUES(10,2,'root','2026-01-02');
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(11,2,10,'reply','2026-01-03');
    INSERT INTO follows(follower_id,following_id,created_at) VALUES(2,1,'2026-01-04');`)
  const page = materializedPersonalizedGroupPage(database, 1, 'for-you', 1, 10, 1)
  expect(page.groups.filter(key => key.startsWith('conversation:'))).toHaveLength(1)
  expect(page.totalItems).toBe(2)
  const plan = database.query(`EXPLAIN QUERY PLAN SELECT group_key FROM personalized_feed_groups
    WHERE viewer_id=? AND feed=? AND latest_sequence<?
    ORDER BY latest_sequence DESC,group_key DESC LIMIT ?`).all(1, 'for-you', 1000, 20) as Array<{ detail: string }>
  expect(plan.some(row => row.detail.includes('personalized_feed_groups_page'))).toBeTrue()
})
