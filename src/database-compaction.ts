import type { Database } from 'bun:sqlite'
import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export const COMPACTION_MIN_FREE_PAGES = 1_024
export const COMPACTION_MIN_FREE_RATIO = 0.2

export function shouldCompactDatabase(pageCount: number, freePages: number) {
  return freePages >= COMPACTION_MIN_FREE_PAGES && freePages / Math.max(1, pageCount) >= COMPACTION_MIN_FREE_RATIO
}

export function compactDatabaseAfterMigration(database: Database, path: string) {
  if (path === ':memory:' || Bun.env.DATABASE_COMPACT_AFTER_MIGRATION === 'false') return false
  const pageCount = (database.query('PRAGMA page_count').get() as { page_count: number }).page_count
  const freePages = (database.query('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count
  if (!shouldCompactDatabase(pageCount, freePages)) return false

  const databaseBytes = statSync(path).size
  const filesystem = statfsSync(dirname(path))
  const availableBytes = filesystem.bavail * filesystem.bsize
  if (availableBytes < databaseBytes * 1.2) {
    console.warn(`database compact skipped insufficient_space available_bytes=${availableBytes}`
      + ` required_bytes=${Math.ceil(databaseBytes * 1.2)}`)
    return false
  }

  const started = performance.now()
  database.run('VACUUM')
  console.log(`database compact reclaimed_pages=${freePages} duration_ms=${Math.round(performance.now() - started)}`)
  return true
}
