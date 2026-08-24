import { Database } from 'bun:sqlite'
import { appName } from '../src/brand'
import { defaultDatabasePath } from '../src/database-backup'
import { interactedEmail } from '../src/interacted-email'
import { issueInteractedUnsubscribeToken } from '../src/interacted-emails'
import { runMigrations } from '../src/migrations'

export const INTERACTED_CAMPAIGN_VERSION = 'v1'
const SEND_INTERVAL_MS = 1_000
const MAX_RATE_LIMIT_RETRIES = 10

type Candidate = { id: number; handle: string; email: string; email_verified_at: string | null;
  interaction_emails: number; unread_replies: number; oldest_reply_at: string; newest_reply_at: string }
export type UnreadReplyUser = Pick<Candidate,
  'handle' | 'unread_replies' | 'oldest_reply_at' | 'newest_reply_at'>
type Delivery = { id: number; status: 'sending' | 'sent' | 'failed' | 'uncertain'; run_id: string;
  idempotency_key: string }
export type InteractedCampaignEnvironment = { APP_URL?: string; EMAIL_FROM?: string; RESEND_API_KEY?: string }

const usage = `Usage: bun run users:unread-replies -- [options]

Options:
  --min-replies=N  Only include users with at least N unread replies (default 1)
  --max-days=N     Only consider replies from the last N days (default: all time)
  --send-email     Send the interaction email through Resend (default: list only)
  --help           Show this help`

function positiveIntegerArgument(args: string[], name: string, fallback?: number) {
  const prefix = `--${name}=`
  const argument = args.find(value => value.startsWith(prefix))
  if (!argument) return fallback
  const value = Number(argument.slice(prefix.length))
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

function required(value: string | undefined, name: string) {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} must be configured`)
  return trimmed
}

export function unreadReplyCandidates(database: Database, options: { minReplies: number; maxDays?: number }) {
  const ageFilter = options.maxDays === undefined
    ? ''
    : "AND reply.created_at >= datetime('now', '-' || ? || ' days')"
  return database.query(`
    SELECT recipient.id,recipient.handle,recipient.email,recipient.email_verified_at,
           recipient.interaction_emails,count(*) AS unread_replies,
           min(reply.created_at) AS oldest_reply_at,max(reply.created_at) AS newest_reply_at
    FROM posts reply
    JOIN posts parent ON parent.id=reply.parent_id
    JOIN users recipient ON recipient.id=parent.user_id
    JOIN users author ON author.id=reply.user_id
    WHERE reply.deleted_at IS NULL ${ageFilter}
      AND recipient.deleted_at IS NULL AND recipient.suspended_at IS NULL
      AND author.deleted_at IS NULL AND author.suspended_at IS NULL AND reply.user_id!=recipient.id
      AND NOT EXISTS (SELECT 1 FROM to_me_reads seen WHERE seen.user_id=recipient.id
        AND seen.event_key IN ('post:' || reply.id,'post:' || printf('%020d',reply.id)))
      AND NOT EXISTS (SELECT 1 FROM blocks block
        WHERE (block.blocker_id=recipient.id AND block.blocked_id=reply.user_id)
          OR (block.blocker_id=reply.user_id AND block.blocked_id=recipient.id))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=reply.id AND bh.user_id=recipient.id)
    GROUP BY recipient.id,recipient.handle,recipient.email,recipient.email_verified_at,recipient.interaction_emails
    HAVING count(*) >= ?
    ORDER BY unread_replies DESC,newest_reply_at DESC,recipient.handle COLLATE NOCASE
  `).all(...(options.maxDays === undefined ? [options.minReplies] : [options.maxDays, options.minReplies])) as Candidate[]
}

export function unreadReplyUsers(database: Database, options: { minReplies: number; maxDays?: number }) {
  return unreadReplyCandidates(database, options).map(({ handle, unread_replies, oldest_reply_at, newest_reply_at }) =>
    ({ handle, unread_replies, oldest_reply_at, newest_reply_at }))
}

function recipients(database: Database, options: { minReplies: number; maxDays?: number }) {
  const byEmail = new Map<string, Candidate>()
  for (const candidate of unreadReplyCandidates(database, options)) {
    if (!candidate.email_verified_at || candidate.interaction_emails === 0) continue
    const key = candidate.email.trim().toLowerCase()
    if (key && !byEmail.has(key)) byEmail.set(key, candidate)
  }
  return [...byEmail.values()]
}

function claimDelivery(database: Database, recipient: Candidate, runId: string) {
  const key = `interacted-${INTERACTED_CAMPAIGN_VERSION}-${crypto.randomUUID()}`
  database.query(`INSERT OR IGNORE INTO interacted_email_deliveries
    (campaign_version,email,user_id,status,run_id,idempotency_key) VALUES(?,?,?,'sending',?,?)`)
    .run(INTERACTED_CAMPAIGN_VERSION, recipient.email, recipient.id, runId, key)
  let delivery = database.query(`SELECT id,status,run_id,idempotency_key FROM interacted_email_deliveries
    WHERE campaign_version=? AND email=?`).get(INTERACTED_CAMPAIGN_VERSION, recipient.email) as Delivery
  if (delivery.status === 'failed') {
    database.query(`UPDATE interacted_email_deliveries SET status='sending',run_id=?,error=NULL
      WHERE id=? AND status='failed'`).run(runId, delivery.id)
    delivery = database.query(`SELECT id,status,run_id,idempotency_key FROM interacted_email_deliveries WHERE id=?`)
      .get(delivery.id) as Delivery
  }
  return delivery.status === 'sending' && delivery.run_id === runId ? delivery : null
}

function retryDelayMs(response: Response, attempt: number) {
  const value = response.headers.get('retry-after') || response.headers.get('ratelimit-reset')
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(SEND_INTERVAL_MS, Math.ceil(seconds * 1_000))
  return Math.min(60_000, SEND_INTERVAL_MS * 2 ** Math.min(attempt, 6))
}

function plainText(name: string, origin: string, unsubscribeUrl: string) {
  return `People have interacted with you on ${name}.

Someone replied to one of your notes. Go check it out: ${new URL('/to-me', origin).href}

Unsubscribe from interaction emails: ${unsubscribeUrl}`
}

export async function sendInteractedCampaign(options: {
  database: Database; minReplies: number; maxDays?: number; env?: InteractedCampaignEnvironment;
  request?: typeof fetch; sleep?: (ms: number) => Promise<void>; stopping?: () => boolean;
  log?: (message: string) => void
}) {
  const env = options.env || Bun.env
  const origin = new URL(required(env.APP_URL, 'APP_URL')).origin
  const from = required(env.EMAIL_FROM, 'EMAIL_FROM')
  const apiKey = required(env.RESEND_API_KEY, 'RESEND_API_KEY')
  const request = options.request || fetch
  const sleep = options.sleep || Bun.sleep
  const stopping = options.stopping || (() => false)
  const log = options.log || console.log
  const runId = crypto.randomUUID()
  const name = appName()
  let sent = 0, skipped = 0, failed = 0, lastRequestAt = 0

  for (const recipient of recipients(options.database, options)) {
    if (stopping()) break
    const delivery = claimDelivery(options.database, recipient, runId)
    if (!delivery) { skipped++; continue }
    const unsubscribeToken = issueInteractedUnsubscribeToken(options.database, recipient.id)
    const unsubscribe = new URL(
      `/account/interacted-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`, origin).href
    const html = interactedEmail(origin, unsubscribeToken)
    let rateLimitAttempt = 0
    while (true) {
      const spacing = SEND_INTERVAL_MS - (Date.now() - lastRequestAt)
      if (spacing > 0) await sleep(spacing)
      lastRequestAt = Date.now()
      options.database.query('UPDATE interacted_email_deliveries SET attempts=attempts+1 WHERE id=?')
        .run(delivery.id)
      let response: Response
      try {
        response = await request('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json',
            'idempotency-key': delivery.idempotency_key },
          body: JSON.stringify({ from, to: [recipient.email],
            subject: `People have interacted with you · ${name}`,
            text: plainText(name, origin, unsubscribe), html,
            headers: { 'List-Unsubscribe': `<${unsubscribe}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
          signal: AbortSignal.timeout(15_000),
        })
      }
      catch (error) {
        options.database.query(`UPDATE interacted_email_deliveries SET status='uncertain',error=? WHERE id=?`)
          .run(error instanceof Error ? error.message : String(error), delivery.id)
        log(`uncertain ${recipient.email}; not retrying automatically`)
        failed++
        break
      }
      if (response.ok) {
        const result = await response.json().catch(() => ({})) as { id?: string }
        options.database.query(`UPDATE interacted_email_deliveries SET status='sent',provider_id=?,
          sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?`).run(result.id || null, delivery.id)
        log(`sent ${recipient.email} (@${recipient.handle}, ${recipient.unread_replies} unread)`)
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
      options.database.query(`UPDATE interacted_email_deliveries SET status='failed',error=? WHERE id=?`)
        .run(`Resend ${response.status}${detail ? `: ${detail}` : ''}`, delivery.id)
      log(`failed ${recipient.email}: Resend ${response.status}`)
      failed++
      break
    }
  }
  return { version: INTERACTED_CAMPAIGN_VERSION, sent, skipped, failed, stopped: stopping() }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.includes('--help')) { console.log(usage); process.exit(0) }
  const unknown = args.filter(value => value !== '--help' && value !== '--send-email'
    && !value.startsWith('--min-replies=') && !value.startsWith('--max-days='))
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}\n\n${usage}`)
  const minReplies = positiveIntegerArgument(args, 'min-replies', 1)!
  const maxDays = positiveIntegerArgument(args, 'max-days')
  const sendEmail = args.includes('--send-email')
  const database = new Database(Bun.env.DATABASE_PATH || defaultDatabasePath, { readonly: !sendEmail, strict: true })
  try {
    if (!sendEmail) {
      const rows = unreadReplyUsers(database, { minReplies, maxDays })
      if (!rows.length) console.log('No users found.')
      else {
        console.table(rows)
        const replies = rows.reduce((total, row) => total + row.unread_replies, 0)
        console.log(`${rows.length} user${rows.length === 1 ? '' : 's'}, ${replies} unread repl${
          replies === 1 ? 'y' : 'ies'}`)
      }
    }
    else {
      database.run('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
      runMigrations(database, migration => console.log(`database migrate v${migration.version} ${migration.name}`))
      let stopping = false
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
        if (!stopping) console.log(`received ${signal}; finishing the current recipient before stopping`)
        stopping = true
      })
      const result = await sendInteractedCampaign({ database, minReplies, maxDays, stopping: () => stopping })
      console.log(`interaction campaign ${result.version}: sent=${result.sent} skipped=${result.skipped} ` +
        `failed=${result.failed}${result.stopped ? ' stopped=true' : ''}`)
      if (result.failed) process.exitCode = 1
    }
  }
  finally { database.close() }
}
