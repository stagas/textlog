import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabaseBackup, restoreDatabase, verifyDatabaseFile } from './database-backup'

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'root-mx-database-'))
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
})
