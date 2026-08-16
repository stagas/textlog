import type { Database } from 'bun:sqlite'
import { ipPseudonym } from './ip-privacy'

export const VISITOR_RETENTION_DAYS = 7
export const VISITOR_FLUSH_BATCH_SIZE = 500
export const ONLINE_VISITOR_WINDOW_MS = 30 * 60 * 1000

export function visitorHash(address: string, visitedAt = new Date(), secret?: string) {
  return ipPseudonym(address, 'visitor-count', visitedAt, secret)
}

export class VisitorBuffer {
  private pending = new Map<string, { day: string; hash: string; anonymousLastSeenAt: number | null }>()

  constructor(private database: Database, private batchSize = VISITOR_FLUSH_BATCH_SIZE) {}

  record(address: string, visitedAt = new Date(), anonymous = true) {
    if (!address || address === '-') return
    const day = visitedAt.toISOString().slice(0, 10)
    const hash = visitorHash(address, visitedAt)
    const key = `${day}:${hash}`
    const pending = this.pending.get(key)
    this.pending.set(key, {
      day,
      hash,
      anonymousLastSeenAt: anonymous
        ? Math.max(pending?.anonymousLastSeenAt || 0, visitedAt.getTime())
        : pending?.anonymousLastSeenAt || null,
    })
    if (this.pending.size >= this.batchSize) this.flush()
  }

  flush() {
    const visits = [...this.pending.values()].slice(0, this.batchSize)
    if (!visits.length) return 0
    this.database.transaction(() => {
      const insert = this.database.query(`INSERT INTO daily_visitors(day,visitor_hash,anonymous_last_seen_at)
        VALUES(?,?,?) ON CONFLICT(day,visitor_hash) DO UPDATE SET anonymous_last_seen_at=CASE
          WHEN excluded.anonymous_last_seen_at IS NULL THEN daily_visitors.anonymous_last_seen_at
          WHEN daily_visitors.anonymous_last_seen_at IS NULL THEN excluded.anonymous_last_seen_at
          ELSE max(daily_visitors.anonymous_last_seen_at,excluded.anonymous_last_seen_at) END`)
      for (const visit of visits) insert.run(visit.day, visit.hash, visit.anonymousLastSeenAt)
    })()
    for (const visit of visits) this.pending.delete(`${visit.day}:${visit.hash}`)
    return visits.length
  }

  get size() {
    return this.pending.size
  }
}

export function anonymousOnlineCount(database: Database, now = Date.now(), windowMs = ONLINE_VISITOR_WINDOW_MS) {
  return (database.query(`SELECT count(*) count FROM daily_visitors
    WHERE anonymous_last_seen_at>=? AND anonymous_last_seen_at<=?`)
    .get(now - windowMs, now) as { count: number }).count
}

export function visitorStats(database: Database) {
  return database.query(`SELECT
    (SELECT count(*) FROM daily_visitors WHERE day=date('now')) visitorsToday,
    (SELECT count(*) FROM daily_visitors WHERE day=date('now','-1 day')) visitorsYesterday,
    (SELECT count(*) FROM daily_visitors WHERE day>=date('now','-6 days')) visitors7d`)
    .get() as { visitorsToday: number; visitorsYesterday: number; visitors7d: number }
}
