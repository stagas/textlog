import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'

export function visitorHash(address: string) {
  return createHash('sha256').update(`root.mx visitor\0${address}`).digest('hex')
}

export function recordVisit(database: Database, address: string, visitedAt = new Date()) {
  if (!address || address === '-') return
  const day = visitedAt.toISOString().slice(0, 10)
  database.query('INSERT OR IGNORE INTO daily_visitors(day,visitor_hash) VALUES(?,?)')
    .run(day, visitorHash(address))
}

export function visitorStats(database: Database) {
  return database.query(`SELECT
    (SELECT count(*) FROM daily_visitors WHERE day=date('now')) visitorsToday,
    (SELECT count(DISTINCT visitor_hash) FROM daily_visitors WHERE day>=date('now','-6 days')) visitors7d`)
    .get() as { visitorsToday: number; visitors7d: number }
}
