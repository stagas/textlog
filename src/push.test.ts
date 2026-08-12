import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import webpush from 'web-push'
import { runMigrations } from './migrations'
import { sendPushForPost, sendPushForSignup, sendPushForTagFollow, sendPushForUserFollow, sendPushToUser } from './push'

let originalSend: typeof webpush.sendNotification
let vapid: ReturnType<typeof webpush.generateVAPIDKeys> & { subject: string }
const originalEnvironment = Bun.env.NODE_ENV
const originalDevReload = Bun.env.DEV_RELOAD

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
  Bun.env.NODE_ENV = originalEnvironment
  Bun.env.DEV_RELOAD = originalDevReload
})

describe('Web Push activity delivery', () => {
  test('does not send notifications in development', async () => {
    const database = fixture()
    let deliveries = 0
    webpush.sendNotification = (async () => {
      deliveries++
      return {} as never
    }) as typeof webpush.sendNotification

    Bun.env.NODE_ENV = 'development'
    await sendPushToUser(2, { title: 'test', body: 'test', url: '/' }, database, vapid)

    Bun.env.NODE_ENV = 'production'
    Bun.env.DEV_RELOAD = 'true'
    await sendPushToUser(2, { title: 'test', body: 'test', url: '/' }, database, vapid)

    expect(deliveries).toBe(0)
  })

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
      title: '@author replied to you',
      body: 'hello @recipient',
      url: '/post/2',
    })
  })

  test('deletes a subscription after a 410 response', async () => {
    const database = fixture()
    webpush.sendNotification = (async () => {
      throw { statusCode: 410 }
    }) as typeof webpush.sendNotification

    await sendPushToUser(2, { title: 'test', body: 'test', url: '/' }, database, vapid)

    expect(database.query('SELECT count(*) count FROM push_subscriptions').get()).toEqual({ count: 0 })
  })

  test('sends ordinary new posts to subscriptions that enabled latest', async () => {
    const database = fixture()
    database.run('INSERT INTO posts(id,user_id,body) VALUES(3,1,\'an ordinary note\')')
    const payloads: string[] = []
    webpush.sendNotification = (async (_subscription, payload) => {
      payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(3, 1, 'author', database, vapid)

    expect(payloads.map(value => JSON.parse(value))).toEqual([{
      title: '@author wrote',
      body: 'an ordinary note',
      url: '/post/3',
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

  test('sends notes from followed people or tags without enabling all new notes', async () => {
    const database = fixture()
    database.run(`UPDATE push_subscriptions SET notify_latest=0,notify_following_notes=1;
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(2,1,CURRENT_TIMESTAMP);
      INSERT INTO posts(id,user_id,body) VALUES(3,1,'followed person note')`)
    const payloads: string[] = []
    webpush.sendNotification = (async (_subscription, payload) => {
      payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(3, 1, 'author', database, vapid)
    database.run(`DELETE FROM follows WHERE follower_id=2 AND following_id=1;
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(2,'bun',CURRENT_TIMESTAMP);
      INSERT INTO posts(id,user_id,body) VALUES(4,1,'followed tag note');
      INSERT INTO post_hashtags(post_id,tag) VALUES(4,'bun')`)
    await sendPushForPost(4, 1, 'author', database, vapid)
    database.run(`INSERT INTO posts(id,user_id,body) VALUES(5,1,'unrelated note')`)
    await sendPushForPost(5, 1, 'author', database, vapid)

    expect(payloads.map(payload => JSON.parse(payload).body)).toEqual([
      'followed person note',
      'followed tag note',
    ])
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
      title: 'You replied to @recipient',
      body: 'hello @recipient',
      url: '/post/2',
    }])
  })

  test('uses first-person wording for an author own ordinary post', async () => {
    const database = fixture()
    database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
      VALUES('https://push.example/author',1,'author-key','author-auth');
      INSERT INTO posts(id,user_id,body) VALUES(3,1,'my note')`)
    const payloads: string[] = []
    webpush.sendNotification = (async (subscription, payload) => {
      if (subscription.endpoint.endsWith('/author')) payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(3, 1, 'author', database, vapid)

    expect(payloads.map(value => JSON.parse(value))).toEqual([{
      title: 'You wrote',
      body: 'my note',
      url: '/post/3',
    }])
  })

  test('can exclude an author own posts while keeping latest enabled', async () => {
    const database = fixture()
    database.run(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,notify_own_posts)
      VALUES('https://push.example/author',1,'author-key','author-auth',0)`)
    let authorDeliveries = 0
    webpush.sendNotification = (async subscription => {
      if (subscription.endpoint.endsWith('/author')) authorDeliveries++
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForPost(2, 1, 'author', database, vapid)

    expect(authorDeliveries).toBe(0)
  })

  test('sends signup alerts only to administrators who enabled them', async () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (3,'admin','gstagas@gmail.com','!'),(4,'other','other@example.com','!'),(5,'new_user','new@example.com','!');
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,notify_signups) VALUES
      ('https://push.example/admin',3,'admin-key','admin-auth',1),
      ('https://push.example/other',4,'other-key','other-auth',1),
      ('https://push.example/disabled-admin',3,'disabled-key','disabled-auth',0)`)
    const deliveries: { endpoint: string; payload: string }[] = []
    webpush.sendNotification = (async (subscription, payload) => {
      deliveries.push({ endpoint: subscription.endpoint, payload: String(payload) })
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForSignup(5, 'new_user', database, vapid)

    expect(deliveries).toEqual([{
      endpoint: 'https://push.example/admin',
      payload: JSON.stringify({
        title: '@new_user signed up',
        body: '@new_user signed up',
        url: '/admin/users/5',
      }),
    }])
  })

  test('sends followed-person and followed-tag activity to matching subscribers', async () => {
    const database = fixture()
    database.run(`INSERT INTO users(id,handle,email,password) VALUES(3,'watcher','watcher@example.com','!');
      INSERT INTO follows(follower_id,following_id,created_at) VALUES(3,1,CURRENT_TIMESTAMP);
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES(3,'bun',CURRENT_TIMESTAMP);
      INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth)
        VALUES('https://push.example/watcher',3,'watcher-key','watcher-auth')`)
    const payloads: string[] = []
    webpush.sendNotification = (async (_subscription, payload) => {
      payloads.push(String(payload))
      return {} as never
    }) as typeof webpush.sendNotification

    await sendPushForUserFollow(1, 'author', 2, 'recipient', database, vapid)
    await sendPushForTagFollow(1, 'author', 'bun', database, vapid)

    expect(payloads.map(payload => JSON.parse(payload).title)).toEqual([
      '@author followed @recipient',
      '@author followed #bun',
    ])
    database.run('UPDATE push_subscriptions SET notify_follow_activity=0 WHERE user_id=3')
    await sendPushForTagFollow(1, 'author', 'bun', database, vapid)
    expect(payloads).toHaveLength(2)
  })
})
