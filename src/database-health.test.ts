import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { databaseHealth } from './database-health'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'textlog-health-'))
  directories.push(directory)
  const path = join(directory, 'health.sqlite')
  const database = new Database(path, { create: true })
  database.run('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=250; CREATE TABLE state(value INTEGER)')
  return { database, path }
}

describe('database operational health', () => {
  test('reports bounded lock latency, WAL size, and the configured timeout', () => {
    const { database, path } = fixture()
    database.query('INSERT INTO state VALUES(?)').run(1)
    const health = databaseHealth(database, path)
    expect(health.busyTimeoutMs).toBe(250)
    expect(health.writeLockLatencyMs).toBeGreaterThanOrEqual(0)
    expect(health.walBytes).toBeGreaterThan(0)
    database.close()
  })

  test('honors the timeout when another connection holds the write lock', () => {
    const { database, path } = fixture()
    const competing = new Database(path)
    competing.run('PRAGMA busy_timeout=100')
    database.run('BEGIN IMMEDIATE')
    const started = performance.now()
    expect(() => databaseHealth(competing, path)).toThrow()
    expect(performance.now() - started).toBeGreaterThanOrEqual(80)
    database.run('ROLLBACK')
    competing.close()
    database.close()
  })
})
