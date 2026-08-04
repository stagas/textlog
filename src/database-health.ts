import type { Database } from 'bun:sqlite'
import { statSync } from 'node:fs'

export type DatabaseHealth = {
  writeLockLatencyMs: number
  walBytes: number
  busyTimeoutMs: number
}

export function databaseHealth(database: Database, databasePath: string): DatabaseHealth {
  const started = performance.now()
  database.run('BEGIN IMMEDIATE')
  try {
    database.query('SELECT 1').get()
  }
  finally {
    database.run('ROLLBACK')
  }
  let walBytes = 0
  try {
    walBytes = statSync(`${databasePath}-wal`).size
  }
  catch {}
  const busyTimeoutMs = (database.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout
  return {
    writeLockLatencyMs: Math.round((performance.now() - started) * 100) / 100,
    walBytes,
    busyTimeoutMs,
  }
}
