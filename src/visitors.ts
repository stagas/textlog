import type { Database } from 'bun:sqlite'
import { ipPseudonym } from './ip-privacy'

export const VISITOR_RETENTION_DAYS = 7
export const VISITOR_FLUSH_BATCH_SIZE = 500

export function visitorHash(address: string, visitedAt = new Date(), secret?: string) {
  return ipPseudonym(address, 'visitor-count', visitedAt, secret)
}

export class VisitorBuffer {
  private pending = new Map<string, { day: string; hash: string }>()

  constructor(private database: Database, private batchSize = VISITOR_FLUSH_BATCH_SIZE) {}

  record(address: string, visitedAt = new Date()) {
    if (!address || address === '-') return
    const day = visitedAt.toISOString().slice(0, 10)
    const hash = visitorHash(address, visitedAt)
    this.pending.set(`${day}:${hash}`, { day, hash })
    if (this.pending.size >= this.batchSize) this.flush()
  }

  flush() {
    const visits = [...this.pending.values()].slice(0, this.batchSize)
    if (!visits.length) return 0
    this.database.transaction(() => {
      const insert = this.database.query('INSERT OR IGNORE INTO daily_visitors(day,visitor_hash) VALUES(?,?)')
      for (const visit of visits) insert.run(visit.day, visit.hash)
    })()
    for (const visit of visits) this.pending.delete(`${visit.day}:${visit.hash}`)
    return visits.length
  }

  get size() {
    return this.pending.size
  }
}

export function visitorStats(database: Database) {
  return database.query(`SELECT
    (SELECT count(*) FROM daily_visitors WHERE day=date('now')) visitorsToday,
    (SELECT count(*) FROM daily_visitors WHERE day=date('now','-1 day')) visitorsYesterday,
    (SELECT count(*) FROM daily_visitors WHERE day>=date('now','-6 days')) visitors7d`)
    .get() as { visitorsToday: number; visitorsYesterday: number; visitors7d: number }
}
