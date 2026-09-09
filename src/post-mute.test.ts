import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { unreadForYouCount, unreadToMeCount } from './for-you-state'
import { initializeLatestReads, unreadLatestCount } from './latest-state'
import { runMigrations } from './migrations'

function fixture() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'owner','owner@example.com','!'),(2,'replier','replier@example.com','!'),
    (3,'other','other@example.com','!');
    INSERT INTO posts(id,user_id,body) VALUES(1,1,'root');`)
  initializeLatestReads(1, database)
  return database
}

test('muting a post marks new direct and deep replies read outside the mention feed', async () => {
  const database = fixture()
  expect(await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 }))
    .toEqual({ status: 'ready', muted: true })

  database.run(`INSERT INTO posts(id,user_id,parent_id,body) VALUES
    (2,2,1,'direct reply'),(3,2,2,'deep reply')`)

  expect(unreadForYouCount(1, database)).toBe(0)
  expect(unreadToMeCount(1, database)).toBe(0)
  expect(unreadLatestCount(1, database)).toBe(0)
})

test('unmuting restores unread activity for future replies', async () => {
  const database = fixture()
  await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 })
  database.run('INSERT INTO posts(id,user_id,parent_id,body) VALUES(2,2,1,\'muted reply\')')
  expect(await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 }))
    .toEqual({ status: 'ready', muted: false })
  database.run('INSERT INTO posts(id,user_id,parent_id,body) VALUES(3,2,1,\'new reply\')')

  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=1 AND event_key LIKE \'%3\'').get()).toBeNull()
  expect(database.query('SELECT 1 FROM to_me_reads WHERE user_id=1 AND event_key LIKE \'%3\'').get()).toBeNull()
  expect(unreadLatestCount(1, database)).toBe(1)
})

test('any user can mute a thread and its descendants produce no ordinary push delivery', async () => {
  const database = fixture()
  expect(await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 3, postId: 1 }))
    .toEqual({ status: 'ready', muted: true })
  database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/other',3,'key','auth');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES(2,2,1,'direct'),(3,2,2,'deep')`)

  expect((await executeDatabaseDomain(database, 'push.postDelivery', { postId: 2, actorId: 2 })).subscriptions)
    .toEqual([])
  expect((await executeDatabaseDomain(database, 'push.postDelivery', { postId: 3, actorId: 2 })).subscriptions)
    .toEqual([])
})

test('an explicit mention stays unread under @ and sends a mention push in a muted thread', async () => {
  const database = fixture()
  await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 })
  database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/owner',1,'key','auth');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES(2,2,1,'hello @owner');
    INSERT INTO post_mentions(post_id,user_id) VALUES(2,1)`)

  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=1 AND event_key LIKE \'%2\'').get()).toBeNull()
  expect(database.query('SELECT 1 FROM to_me_reads WHERE user_id=1 AND event_key LIKE \'%2\'').get()).toBeNull()
  expect(database.query('SELECT 1 FROM post_mentions WHERE post_id=2 AND user_id=1').get()).not.toBeNull()
  expect(unreadLatestCount(1, database)).toBe(0)
  const delivery = await executeDatabaseDomain(database, 'push.postDelivery', { postId: 2, actorId: 2 })
  expect(delivery.subscriptions).toEqual([expect.objectContaining({ userId: 1, isReply: 0, isMention: 1 })])
})
