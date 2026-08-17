import { Database } from 'bun:sqlite'
import { ADMIN_EMAILS } from '../src/admin'
import { appName } from '../src/brand'
import { defaultDatabasePath } from '../src/database-backup'
import { runMigrations } from '../src/migrations'
import { recapEmailForUser } from '../src/recap-email'

export const RECAP_CAMPAIGN_VERSION = 'v1'
const SEND_INTERVAL_MS = 1_000
const MAX_RATE_LIMIT_RETRIES = 10

type Recipient = { id: number; email: string }
type Delivery = { id: number; status: 'sending' | 'sent' | 'failed' | 'uncertain'; run_id: string;
  idempotency_key: string }

export type CampaignEnvironment = {
  APP_URL?: string
  EMAIL_FROM?: string
  RESEND_API_KEY?: string
  DATABASE_PATH?: string
}

function required(value: string | undefined, name: string) {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} must be configured`)
  return trimmed
}

function retryDelayMs(response: Response, attempt: number) {
  const value = response.headers.get('retry-after') || response.headers.get('ratelimit-reset')
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(SEND_INTERVAL_MS, Math.ceil(seconds * 1_000))
  return Math.min(60_000, SEND_INTERVAL_MS * 2 ** Math.min(attempt, 6))
}

function recipients(database: Database, testMode: boolean, adminEmails: Iterable<string>) {
  if (testMode) {
    const emails = [...new Set([...adminEmails].map(email => email.trim().toLowerCase()).filter(Boolean))]
    if (!emails.length) throw new Error('No administrator emails are configured')
    const rows = database.query(`SELECT min(id) id,email FROM users
      WHERE lower(email) IN (${emails.map(() => '?').join(',')}) AND deleted_at IS NULL AND suspended_at IS NULL
      GROUP BY lower(email) ORDER BY id`).all(...emails) as Recipient[]
    const found = new Set(rows.map(row => row.email.toLowerCase()))
    const missing = emails.filter(email => !found.has(email))
    if (missing.length) throw new Error(`Administrator accounts not found: ${missing.join(', ')}`)
    return rows
  }
  return database.query(`SELECT min(id) id,email FROM users
    WHERE recap_emails=1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL AND suspended_at IS NULL
    GROUP BY lower(email) ORDER BY id`).all() as Recipient[]
}

function claimDelivery(database: Database, recipient: Recipient, runId: string) {
  const key = `recap-${RECAP_CAMPAIGN_VERSION}-${crypto.randomUUID()}`
  database.query(`INSERT OR IGNORE INTO recap_email_deliveries
    (campaign_version,email,user_id,status,run_id,idempotency_key) VALUES(?,?,?,'sending',?,?)`)
    .run(RECAP_CAMPAIGN_VERSION, recipient.email, recipient.id, runId, key)
  let delivery = database.query(`SELECT id,status,run_id,idempotency_key FROM recap_email_deliveries
    WHERE campaign_version=? AND email=?`).get(RECAP_CAMPAIGN_VERSION, recipient.email) as Delivery
  if (delivery.status === 'failed') {
    database.query(`UPDATE recap_email_deliveries SET status='sending',run_id=?,error=NULL
      WHERE id=? AND status='failed'`).run(runId, delivery.id)
    delivery = database.query(`SELECT id,status,run_id,idempotency_key FROM recap_email_deliveries WHERE id=?`)
      .get(delivery.id) as Delivery
  }
  return delivery.status === 'sending' && delivery.run_id === runId ? delivery : null
}

function plainText(name: string, origin: string, unsubscribeUrl: string) {
  return `A lot has happened. Quietly, of course.

Since launch, ${name} has added richer writing, better discovery and conversations, appearance controls, notifications, multiple accounts, feeds, embeds, an API, a public archive, and an Android app.

See what's happening: ${new URL('/hot', origin).href}

Unsubscribe from recap emails: ${unsubscribeUrl}`
}

async function wait(ms: number) {
  await Bun.sleep(ms)
}

export async function sendRecapCampaign(options: {
  database: Database
  env?: CampaignEnvironment
  request?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  stopping?: () => boolean
  log?: (message: string) => void
  testMode?: boolean
  adminEmails?: Iterable<string>
}) {
  const env = options.env || Bun.env
  const origin = new URL(required(env.APP_URL, 'APP_URL')).origin
  const from = required(env.EMAIL_FROM, 'EMAIL_FROM')
  const apiKey = required(env.RESEND_API_KEY, 'RESEND_API_KEY')
  const request = options.request || fetch
  const sleep = options.sleep || wait
  const stopping = options.stopping || (() => false)
  const log = options.log || console.log
  const testMode = options.testMode === true
  const runId = crypto.randomUUID()
  const name = appName()
  let sent = 0
  let skipped = 0
  let failed = 0
  let lastRequestAt = 0

  for (const recipient of recipients(options.database, testMode, options.adminEmails || ADMIN_EMAILS)) {
    if (stopping()) break
    const delivery = testMode
      ? { id: 0, status: 'sending' as const, run_id: runId,
        idempotency_key: `recap-${RECAP_CAMPAIGN_VERSION}-test-${crypto.randomUUID()}` }
      : claimDelivery(options.database, recipient, runId)
    if (!delivery) {
      skipped++
      continue
    }
    const html = recapEmailForUser(options.database, origin, recipient.id)
    const unsubscribe = html.match(/href="([^"]+)"[^>]*>Unsubscribe from recap emails<\/a>/)?.[1]
      ?.replaceAll('&amp;', '&')
    if (!unsubscribe) throw new Error('Recap email did not contain an unsubscribe URL')
    let rateLimitAttempt = 0
    while (true) {
      const spacing = SEND_INTERVAL_MS - (Date.now() - lastRequestAt)
      if (spacing > 0) await sleep(spacing)
      lastRequestAt = Date.now()
      if (!testMode) {
        options.database.query('UPDATE recap_email_deliveries SET attempts=attempts+1 WHERE id=?').run(delivery.id)
      }
      let response: Response
      try {
        response = await request('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': delivery.idempotency_key,
          },
          body: JSON.stringify({
            from,
            to: [recipient.email],
            subject: `${testMode ? '[TEST] ' : ''}A lot has happened · ${name}`,
            text: plainText(name, origin, unsubscribe),
            html,
            headers: {
              'List-Unsubscribe': `<${unsubscribe}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }),
          signal: AbortSignal.timeout(15_000),
        })
      }
      catch (error) {
        if (!testMode) {
          options.database.query(`UPDATE recap_email_deliveries SET status='uncertain',error=? WHERE id=?`)
            .run(error instanceof Error ? error.message : String(error), delivery.id)
        }
        log(`uncertain ${recipient.email}; not retrying automatically`)
        failed++
        break
      }
      if (response.ok) {
        const result = await response.json().catch(() => ({})) as { id?: string }
        if (!testMode) {
          options.database.query(`UPDATE recap_email_deliveries
            SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?`)
            .run(result.id || null, delivery.id)
        }
        log(`sent ${recipient.email}`)
        sent++
        break
      }
      const detail = (await response.text()).trim().slice(0, 1_000)
      if (response.status === 429 && rateLimitAttempt < MAX_RATE_LIMIT_RETRIES && !stopping()) {
        const delay = retryDelayMs(response, rateLimitAttempt++)
        log(`rate limited; retrying ${recipient.email} in ${Math.ceil(delay / 1_000)}s`)
        await sleep(delay)
        continue
      }
      if (!testMode) {
        options.database.query(`UPDATE recap_email_deliveries SET status='failed',error=? WHERE id=?`)
          .run(`Resend ${response.status}${detail ? `: ${detail}` : ''}`, delivery.id)
      }
      log(`failed ${recipient.email}: Resend ${response.status}`)
      failed++
      break
    }
  }
  return { version: RECAP_CAMPAIGN_VERSION, testMode, sent, skipped, failed, stopped: stopping() }
}

if (import.meta.main) {
  const testMode = Bun.argv.slice(2).includes('--test')
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (!stopping) console.log(`received ${signal}; finishing the current recipient before stopping`)
      stopping = true
    })
  }
  const database = new Database(Bun.env.DATABASE_PATH || defaultDatabasePath, { strict: true })
  database.run('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
  runMigrations(database, migration => console.log(`database migrate v${migration.version} ${migration.name}`))
  try {
    const result = await sendRecapCampaign({ database, stopping: () => stopping, testMode })
    console.log(`recap ${result.version}${result.testMode ? ' test' : ''}: sent=${result.sent} skipped=${
      result.skipped
    } failed=${result.failed}${
      result.stopped ? ' stopped=true' : ''
    }`)
    if (result.failed) process.exitCode = 1
  }
  finally {
    database.close()
  }
}
