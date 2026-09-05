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
    (1,'owner','owner@example.com','!'),(2,'replier','replier@example.com','!');
    INSERT INTO posts(id,user_id,body) VALUES(1,1,'root');`)
  initializeLatestReads(1, database)
  return database
}

test('muting a post marks new direct and deep replies read in every feed', async () => {
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
  database.run("INSERT INTO posts(id,user_id,parent_id,body) VALUES(2,2,1,'muted reply')")
  expect(await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 }))
    .toEqual({ status: 'ready', muted: false })
  database.run("INSERT INTO posts(id,user_id,parent_id,body) VALUES(3,2,1,'new reply')")

  expect(database.query("SELECT 1 FROM for_you_reads WHERE user_id=1 AND event_key LIKE '%3'").get()).toBeNull()
  expect(database.query("SELECT 1 FROM to_me_reads WHERE user_id=1 AND event_key LIKE '%3'").get()).toBeNull()
  expect(unreadLatestCount(1, database)).toBe(1)
})

test('only a post owner can mute it and muted descendants produce no push delivery', async () => {
  const database = fixture()
  expect(await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 2, postId: 1 }))
    .toEqual({ status: 'forbidden' })
  await executeDatabaseDomain(database, 'interactions.togglePostMute', { userId: 1, postId: 1 })
  database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/owner',1,'key','auth');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES(2,2,1,'direct'),(3,2,2,'deep')`)

  expect((await executeDatabaseDomain(database, 'push.postDelivery', { postId: 2, actorId: 2 })).subscriptions)
    .toEqual([])
  expect((await executeDatabaseDomain(database, 'push.postDelivery', { postId: 3, actorId: 2 })).subscriptions)
    .toEqual([])
})
