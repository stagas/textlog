import type { Database } from 'bun:sqlite'
import { ipPseudonym } from './ip-privacy'

export const VISITOR_RETENTION_DAYS = 7

export function visitorHash(address: string, visitedAt = new Date(), secret?: string) {
  return ipPseudonym(address, 'visitor-count', visitedAt, secret)
}

export function recordVisit(database: Database, address: string, visitedAt = new Date()) {
  if (!address || address === '-') return
  const day = visitedAt.toISOString().slice(0, 10)
  database.query('DELETE FROM daily_visitors WHERE day<date(?,\'-6 days\')').run(day)
  database.query('INSERT OR IGNORE INTO daily_visitors(day,visitor_hash) VALUES(?,?)')
    .run(day, visitorHash(address, visitedAt))
}

export function visitorStats(database: Database) {
  return database.query(`SELECT
    (SELECT count(*) FROM daily_visitors WHERE day=date('now')) visitorsToday,
    (SELECT count(*) FROM daily_visitors WHERE day>=date('now','-6 days')) visitors7d`)
    .get() as { visitorsToday: number; visitors7d: number }
}
