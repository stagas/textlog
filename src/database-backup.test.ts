import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabaseBackup, pruneBackups, restoreDatabase, verifyDatabaseFile } from './database-backup'

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'textlog-database-'))
  temporaryDirectories.push(directory)
  return directory
}

function databaseAt(path: string, value: string) {
  const database = new Database(path, { create: true })
  database.run('PRAGMA journal_mode=WAL')
  database.run(`CREATE TABLE state(value TEXT); INSERT INTO state VALUES('${value}')`)
  database.run('PRAGMA user_version=3')
  return database
}

describe('database recovery', () => {
  test('creates and verifies a consistent restricted backup', () => {
    const directory = temporaryDirectory()
    const database = databaseAt(join(directory, 'source.sqlite'), 'preserved')

    const backup = createDatabaseBackup(database, { directory: join(directory, 'backups'), kind: 'manual' })
    database.close()

    expect(existsSync(backup)).toBe(true)
    expect(statSync(backup).mode & 0o777).toBe(0o600)
    expect(verifyDatabaseFile(backup)).toEqual({ version: 3 })
    const restored = new Database(backup, { readonly: true })
    expect(restored.query('SELECT value FROM state').get()).toEqual({ value: 'preserved' })
    restored.close()
  })

  test('restores a verified backup and keeps a safety snapshot of the replaced database', () => {
    const directory = temporaryDirectory()
    const backupSource = databaseAt(join(directory, 'source.sqlite'), 'from-backup')
    const backup = createDatabaseBackup(backupSource, { directory: join(directory, 'backups'), kind: 'manual' })
    backupSource.close()
    databaseAt(join(directory, 'live.sqlite'), 'before-restore').close()

    const result = restoreDatabase(join(directory, 'live.sqlite'), backup, join(directory, 'backups'))

    expect(result.safetyBackup && existsSync(result.safetyBackup)).toBe(true)
    const live = new Database(join(directory, 'live.sqlite'), { readonly: true })
    expect(live.query('SELECT value FROM state').get()).toEqual({ value: 'from-backup' })
    live.close()
  })

  test('keeps only the ten newest migration and regular backups independently', () => {
    const directory = temporaryDirectory()
    const source = join(directory, 'source.sqlite')
    databaseAt(source, 'preserved').close()
    const backups = join(directory, 'backups')
    mkdirSync(backups)
    const baseTime = new Date('2026-08-01T00:00:00Z').getTime()
    for (const category of ['pre-migration-v1-to-v2', 'manual']) {
      for (let index = 0; index < 12; index++) {
        const path = join(backups, `textlog-${category}-2026-08-${String(index + 1).padStart(2, '0')}.sqlite`)
        copyFileSync(source, path)
        const modified = new Date(baseTime + index * 60_000)
        utimesSync(path, modified, modified)
      }
    }

    expect(pruneBackups(backups, new Date('2026-08-14T00:00:00Z').getTime())).toBe(4)
    expect(readdirSync(backups).filter(name => name.includes('pre-migration'))).toHaveLength(10)
    expect(readdirSync(backups).filter(name => name.includes('manual'))).toHaveLength(10)
  })
})
