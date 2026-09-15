import type { Database } from 'bun:sqlite'
import type { VisitorBuffer } from './visitors'

export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000
export const CLEANUP_BATCH_SIZE = 500

function deleteBatch(database: Database, table: string, predicate: string, value: string | number) {
  return database.query(`DELETE FROM ${table} WHERE rowid IN (
    SELECT rowid FROM ${table} WHERE ${predicate} LIMIT ?
  )`).run(value, CLEANUP_BATCH_SIZE).changes
}

export function runBoundedCleanup(database: Database, now = Date.now()) {
  return database.transaction(() => ({
    sessions: deleteBatch(database, 'sessions', 'expires_at<=?', now),
    passwordResets: deleteBatch(database, 'password_resets', 'expires_at<=?', now),
    emailTokens: deleteBatch(database, 'email_tokens', 'expires_at<=?', now),
    accountDeletionTokens: deleteBatch(database, 'account_deletion_tokens', 'expires_at<=?', now),
    passwordEnableTokens: deleteBatch(database, 'password_enable_tokens', 'expires_at<=?', now),
    emailChangeAuthorizations: deleteBatch(database, 'email_change_authorizations', 'expires_at<=?', now),
    magicLinks: deleteBatch(database, 'magic_links', 'expires_at<=?', now),
    passwordLoginNonces: deleteBatch(database, 'password_login_nonces', 'expires_at<=?', now),
    authRateLimits: deleteBatch(database, 'auth_rate_limits', 'created_at<=?', now - 24 * 60 * 60 * 1000),
    apiRateLimits: deleteBatch(database, 'api_rate_limit_buckets', 'bucket_start<?', now - 2 * 60 * 1000),
    visitors: deleteBatch(database, 'daily_visitors', 'day<date(?,\'-6 days\')', new Date(now).toISOString()),
    ipRequests: deleteBatch(database, 'daily_ip_requests', 'day<date(?,\'-6 days\')', new Date(now).toISOString()),
  }))()
}

export function startMaintenance(database: Database, visitors: VisitorBuffer,
  onError: (error: unknown) => void = console.error)
{
  const safely = (task: () => unknown) => {
    try {
      task()
    }
    catch (error) {
      onError(error)
    }
  }
  safely(() => runBoundedCleanup(database))
  const visitorTimer = setInterval(() => safely(() => visitors.flush()), 5_000)
  const cleanupTimer = setInterval(() => safely(() => runBoundedCleanup(database)), MAINTENANCE_INTERVAL_MS)
  visitorTimer.unref()
  cleanupTimer.unref()
  return () => {
    clearInterval(visitorTimer)
    clearInterval(cleanupTimer)
    visitors.flush()
  }
}
