import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { sendInteractedCampaign, unreadReplyCandidates } from '../scripts/list-unread-reply-users'

function campaignDatabase() {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,handle TEXT,email TEXT,email_verified_at TEXT,interaction_emails INTEGER,
    deleted_at TEXT,suspended_at TEXT
  );
  CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,parent_id INTEGER,created_at TEXT,deleted_at TEXT);
  CREATE TABLE to_me_reads (user_id INTEGER,event_key TEXT);
  CREATE TABLE blocks (blocker_id INTEGER,blocked_id INTEGER);
  CREATE TABLE post_hashtags (post_id INTEGER,tag TEXT);
  CREATE TABLE blocked_hashtags (user_id INTEGER,tag TEXT);
  CREATE TABLE interacted_unsubscribe_tokens (
    token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE interacted_email_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_version TEXT NOT NULL,email TEXT NOT NULL,user_id INTEGER NOT NULL,
    status TEXT NOT NULL,run_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,attempts INTEGER DEFAULT 0,
    provider_id TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,
    UNIQUE(campaign_version,email)
  );
  INSERT INTO users VALUES
    (1,'reader','reader@example.com',CURRENT_TIMESTAMP,1,NULL,NULL),
    (2,'writer','writer@example.com',CURRENT_TIMESTAMP,1,NULL,NULL),
    (3,'unsubscribed','no@example.com',CURRENT_TIMESTAMP,0,NULL,NULL),
    (4,'unverified','later@example.com',NULL,1,NULL,NULL);
  INSERT INTO posts VALUES
    (10,1,NULL,'2026-08-01 10:00:00',NULL),(11,2,10,'2026-08-02 10:00:00',NULL),
    (12,3,NULL,'2026-08-01 10:00:00',NULL),(13,2,12,'2026-08-02 10:00:00',NULL),
    (14,4,NULL,'2026-08-01 10:00:00',NULL),(15,2,14,'2026-08-02 10:00:00',NULL);`)
  return database
}

test('interaction campaign sends eligible recipients once with Resend pacing and idempotency', async () => {
  const database = campaignDatabase()
  const requests: { headers: Headers; body: Record<string, unknown> }[] = []
  const sleeps: number[] = []
  let attempt = 0
  const options = {
    database,
    minReplies: 1,
    env: { APP_URL: 'https://textlog.test', EMAIL_FROM: 'textlog <hello@textlog.test>', RESEND_API_KEY: 'secret' },
    request: (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return ++attempt === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json({ id: 'message-1' })
    }) as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
    log: () => {},
  }

  expect(unreadReplyCandidates(database, { minReplies: 1 })).toHaveLength(3)

  expect(await sendInteractedCampaign(options)).toMatchObject({ version: 'v1', sent: 1, skipped: 0, failed: 0 })
  expect(await sendInteractedCampaign(options)).toMatchObject({ version: 'v1', sent: 0, skipped: 1, failed: 0 })
  expect(requests).toHaveLength(2)
  expect(requests[0].headers.get('idempotency-key')).toBe(requests[1].headers.get('idempotency-key'))
  expect(sleeps.some(ms => ms >= 1_000)).toBe(true)
  expect(requests[1].body).toMatchObject({
    to: ['reader@example.com'],
    subject: 'People have interacted with you · textlog',
    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  })
  expect(String(requests[1].body.html)).toContain('/@')
  expect(String(requests[1].body.html)).toContain('/account/interacted-emails/unsubscribe?token=')
  expect(database.query('SELECT count(*) count FROM interacted_unsubscribe_tokens').get()).toEqual({ count: 1 })
  expect(database.query(`SELECT status,attempts,provider_id FROM interacted_email_deliveries`).get()).toEqual({
    status: 'sent',
    attempts: 2,
    provider_id: 'message-1',
  })
})

test('interaction campaign does not retry an ambiguous delivery on restart', async () => {
  const database = campaignDatabase()
  let requests = 0
  const options = {
    database,
    minReplies: 1,
    env: { APP_URL: 'https://textlog.test', EMAIL_FROM: 'textlog <hello@textlog.test>', RESEND_API_KEY: 'secret' },
    request: (async () => {
      requests++
      throw new Error('connection lost after request')
    }) as unknown as typeof fetch,
    sleep: async () => {},
    log: () => {},
  }
  expect(await sendInteractedCampaign(options)).toMatchObject({ sent: 0, failed: 1 })
  expect(await sendInteractedCampaign(options)).toMatchObject({ sent: 0, skipped: 1, failed: 0 })
  expect(requests).toBe(1)
  expect(database.query('SELECT status FROM interacted_email_deliveries').get()).toEqual({ status: 'uncertain' })
})

test('v2 omits users with unread replies predating the v1 campaign', () => {
  const database = campaignDatabase()
  database.run(`INSERT INTO interacted_email_deliveries
    (campaign_version,email,user_id,status,run_id,idempotency_key,created_at)
    VALUES ('v1','sent@example.com',99,'sent','old-run','old-key','2026-08-02 12:00:00')`)

  expect(unreadReplyCandidates(database, { minReplies: 1, version: 'v2' })).toHaveLength(0)

  database.run(`UPDATE posts SET created_at='2026-08-03 10:00:00' WHERE parent_id IS NOT NULL`)
  expect(unreadReplyCandidates(database, { minReplies: 1, version: 'v2' })).toHaveLength(3)
})

test('v3 only counts unread replies created after the v2 campaign finished', () => {
  const database = campaignDatabase()
  database.run(`INSERT INTO interacted_email_deliveries
    (campaign_version,email,user_id,status,run_id,idempotency_key,created_at,sent_at)
    VALUES
      ('v2','first@example.com',98,'sent','old-run','old-key-1','2026-08-02 11:00:00','2026-08-02 12:00:00'),
      ('v2','last@example.com',99,'sent','old-run','old-key-2','2026-08-02 11:00:00','2026-08-02 13:00:00')`)

  expect(unreadReplyCandidates(database, { minReplies: 1, version: 'v3' })).toHaveLength(0)

  database.run(`UPDATE posts SET created_at='2026-08-02 13:00:01' WHERE id=11`)
  expect(unreadReplyCandidates(database, { minReplies: 1, version: 'v3' })).toEqual([
    expect.objectContaining({ handle: 'reader', unread_replies: 1 }),
  ])
})
