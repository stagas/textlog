import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { sendRecapCampaign } from '../scripts/send-recap-email'
import { accountForRecapToken } from './recap-emails'

function campaignDatabase() {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT,recap_emails INTEGER,
    email_verified_at TEXT,deleted_at TEXT,suspended_at TEXT
  );
  CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,body TEXT,deleted_at TEXT);
  CREATE TABLE recap_unsubscribe_tokens (
    token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE recap_email_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_version TEXT NOT NULL,email TEXT NOT NULL,user_id INTEGER NOT NULL,
    status TEXT NOT NULL,run_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,attempts INTEGER DEFAULT 0,
    provider_id TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,
    UNIQUE(campaign_version,email)
  );
  INSERT INTO users VALUES(1,'reader','reader@example.com','',1,CURRENT_TIMESTAMP,NULL,NULL);`)
  return database
}

test('recap campaign honors rate limits and never resends a completed version', async () => {
  const database = campaignDatabase()
  const requests: { headers: Headers; body: Record<string, unknown> }[] = []
  const sleeps: number[] = []
  let attempt = 0
  const request = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    attempt++
    return attempt === 1
      ? new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
      : Response.json({ id: 'resend-message-1' })
  }
  const options = {
    database,
    env: {
      APP_URL: 'https://textlog.test',
      EMAIL_FROM: 'textlog <hello@textlog.test>',
      RESEND_API_KEY: 'secret',
    },
    request: request as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
    log: () => {},
  }

  expect(await sendRecapCampaign(options)).toMatchObject({ version: 'v1', sent: 1, skipped: 0, failed: 0 })
  expect(await sendRecapCampaign(options)).toMatchObject({ version: 'v1', sent: 0, skipped: 1, failed: 0 })
  expect(requests).toHaveLength(2)
  expect(requests[0].headers.get('idempotency-key')).toBe(requests[1].headers.get('idempotency-key'))
  expect(sleeps.some(ms => ms >= 2_000)).toBe(true)
  expect(requests[1].body).toMatchObject({
    to: ['reader@example.com'],
    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  })
  const messageHeaders = requests[1].body.headers as Record<string, string>
  const unsubscribeUrl = messageHeaders['List-Unsubscribe'].slice(1, -1)
  const unsubscribeToken = new URL(unsubscribeUrl).searchParams.get('token') || ''
  expect(accountForRecapToken(database, unsubscribeToken)).toMatchObject({ id: 1, email: 'reader@example.com' })
  expect(String(requests[1].body.html)).toContain(`token=${unsubscribeToken}`)
  expect(database.query(`SELECT campaign_version,status,attempts,provider_id
    FROM recap_email_deliveries`).get()).toEqual({
    campaign_version: 'v1',
    status: 'sent',
    attempts: 2,
    provider_id: 'resend-message-1',
  })
})

test('--test sends only to admins and does not read or write campaign history', async () => {
  const database = campaignDatabase()
  database.run(`INSERT INTO recap_email_deliveries
    (campaign_version,email,user_id,status,run_id,idempotency_key,attempts,sent_at)
    VALUES('v1','reader@example.com',1,'sent','old-run','old-key',1,CURRENT_TIMESTAMP)`)
  const messages: Record<string, unknown>[] = []
  const options = {
    database,
    env: {
      APP_URL: 'https://textlog.test',
      EMAIL_FROM: 'textlog <hello@textlog.test>',
      RESEND_API_KEY: 'secret',
    },
    testMode: true,
    adminEmails: ['reader@example.com'],
    request: (async (_input: string | URL | Request, init?: RequestInit) => {
      messages.push(JSON.parse(String(init?.body)))
      return Response.json({ id: crypto.randomUUID() })
    }) as typeof fetch,
    sleep: async () => {},
    log: () => {},
  }

  expect(await sendRecapCampaign(options)).toMatchObject({ testMode: true, sent: 1, skipped: 0 })
  expect(await sendRecapCampaign(options)).toMatchObject({ testMode: true, sent: 1, skipped: 0 })
  expect(messages).toHaveLength(2)
  expect(messages.every(message => message.subject === '[TEST] A lot has happened · textlog')).toBe(true)
  expect(database.query('SELECT count(*) count FROM recap_email_deliveries').get()).toEqual({ count: 1 })
})

test('an ambiguous network outcome is not retried on restart', async () => {
  const database = campaignDatabase()
  let requests = 0
  const options = {
    database,
    env: {
      APP_URL: 'https://textlog.test',
      EMAIL_FROM: 'textlog <hello@textlog.test>',
      RESEND_API_KEY: 'secret',
    },
    request: (async () => {
      requests++
      throw new Error('connection lost after request')
    }) as unknown as typeof fetch,
    sleep: async () => {},
    log: () => {},
  }

  expect(await sendRecapCampaign(options)).toMatchObject({ sent: 0, failed: 1 })
  expect(await sendRecapCampaign(options)).toMatchObject({ sent: 0, skipped: 1, failed: 0 })
  expect(requests).toBe(1)
  expect(database.query('SELECT status FROM recap_email_deliveries').get()).toEqual({ status: 'uncertain' })
})
