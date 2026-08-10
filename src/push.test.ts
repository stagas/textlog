import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import webpush from 'web-push'
import { runMigrations } from './migrations'
import { sendPushForPost, sendPushToUser } from './push'

let originalSend: typeof webpush.sendNotification
let vapid: ReturnType<typeof webpush.generateVAPIDKeys> & { subject: string }

function fixture() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
    (1,'author','author@example.com','!'),(2,'recipient','recipient@example.com','!');
    INSERT INTO posts(id,user_id,body) VALUES(1,2,'parent'),(2,1,'hello @recipient');
    UPDATE posts SET parent_id=1 WHERE id=2;
    INSERT INTO post_mentions(post_id,user_id) VALUES(2,2);
    INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/one',2,'key','auth');`)
  return database
}

beforeEach(() => {
  originalSend = webpush.sendNotification
  const keys = webpush.generateVAPIDKeys()
  vapid = { ...keys, subject: 'mailto:test@example.com' }
})

afterEach(() => {
  webpush.sendNotification = originalSend
})

describe('Web Push activity delivery', () => {
  test('deduplicates someone who was both replied to and mentioned', async () => {
    const database = fixture()
    const payloads: string[] = []
    webpush.sendNotification = (async (_subscription, payload) => {
      payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(2, 1, 'author', database, vapid)

    expect(payloads).toHaveLength(1)
    expect(JSON.parse(payloads[0])).toEqual({
      title: '@author replied to you', body: 'hello @recipient', url: '/post/2',
    })
  })

  test('deletes a subscription after a 410 response', async () => {
    const database = fixture()
    webpush.sendNotification = (async () => { throw { statusCode: 410 } }) as typeof webpush.sendNotification

    await sendPushToUser(2, { title: 'test', body: 'test', url: '/' }, database, vapid)

    expect(database.query('SELECT count(*) count FROM push_subscriptions').get()).toEqual({ count: 0 })
  })

  test('sends ordinary new posts to subscriptions that enabled latest', async () => {
    const database = fixture()
    database.run("INSERT INTO posts(id,user_id,body) VALUES(3,1,'an ordinary note')")
    const payloads: string[] = []
    webpush.sendNotification = (async (_subscription, payload) => {
      payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(3, 1, 'author', database, vapid)

    expect(payloads.map(value => JSON.parse(value))).toEqual([{
      title: '@author posted in /latest', body: 'an ordinary note', url: '/post/3',
    }])
  })

  test('honors disabled per-subscription post preferences', async () => {
    const database = fixture()
    database.run(`UPDATE push_subscriptions SET notify_latest=0,notify_replies=0,notify_mentions=0`)
    let deliveries = 0
    webpush.sendNotification = (async () => {
      deliveries++
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(2, 1, 'author', database, vapid)

    expect(deliveries).toBe(0)
  })

  test('sends an author their own post as latest without self-activity wording', async () => {
    const database = fixture()
    database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/author',1,'author-key','author-auth')`)
    const payloads: string[] = []
    webpush.sendNotification = (async (subscription, payload) => {
      if (subscription.endpoint.endsWith('/author')) payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(2, 1, 'author', database, vapid)

    expect(payloads.map(value => JSON.parse(value))).toEqual([{
      title: '@author posted in /latest', body: 'hello @recipient', url: '/post/2',
    }])
  })
})
