import type { Database } from 'bun:sqlite'

export type ClearedRateLimitBans = {
  authAttempts: number
  apiBuckets: number
  blockedIps: number
}

/** Clears persistent rate-limit state without deleting posts or other user data. */
export function clearRateLimitBans(database: Database): ClearedRateLimitBans {
  return database.transaction(() => {
    const authAttempts = database.query('DELETE FROM auth_rate_limits').run().changes
    const apiBuckets = database.query('DELETE FROM api_rate_limit_buckets').run().changes
    const blockedIps = database.query(`UPDATE daily_ip_requests
      SET blocked_at=NULL,blocked_by=NULL
      WHERE day=date('now') AND blocked_at IS NOT NULL`).run().changes

    return { authAttempts, apiBuckets, blockedIps }
  })()
}
