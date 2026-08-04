import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export const defaultDatabasePath = Bun.env.DATABASE_PATH || 'storage/root.sqlite'
export const defaultBackupDirectory = Bun.env.DATABASE_BACKUP_DIR || 'storage/backups'

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function retentionDays() {
  const parsed = Number(Bun.env.DATABASE_BACKUP_RETENTION_DAYS || 14)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 14
}

export function verifyDatabaseFile(path: string) {
  const database = new Database(path, { readonly: true, strict: true })
  try {
    const check = database.query('PRAGMA quick_check').get() as { quick_check: string }
    if (check.quick_check !== 'ok') throw new Error(`SQLite quick_check returned ${check.quick_check}`)
    const version = (database.query('PRAGMA user_version').get() as { user_version: number }).user_version
    return { version }
  }
  finally {
    database.close()
  }
}

export function pruneBackups(directory = defaultBackupDirectory, now = Date.now()) {
  if (!existsSync(directory)) return 0
  const cutoff = now - retentionDays() * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of readdirSync(directory)) {
    if (!/^root-(?:(?:pre-migration|manual|pre-restore)-.*|daily-\d{4}-\d{2}-\d{2})\.sqlite$/.test(entry)) continue
    const path = join(directory, entry)
    if (statSync(path).mtimeMs >= cutoff) continue
    rmSync(path)
    removed++
  }
  return removed
}

export function createDatabaseBackup(database: Database, options: {
  directory?: string
  kind: 'pre-migration' | 'manual' | 'pre-restore'
  label?: string
}) {
  const directory = options.directory || defaultBackupDirectory
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const label = options.label ? `-${options.label.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''
  const filename = `root-${options.kind}${label}-${timestamp()}.sqlite`
  const finalPath = resolve(directory, filename)
  const temporaryPath = `${finalPath}.tmp`
  const escapedPath = temporaryPath.replaceAll('\'', '\'\'')
  database.run(`VACUUM INTO '${escapedPath}'`)
  chmodSync(temporaryPath, 0o600)
  verifyDatabaseFile(temporaryPath)
  renameSync(temporaryPath, finalPath)
  chmodSync(finalPath, 0o600)
  pruneBackups(directory)
  return finalPath
}

export function dailyBackupPath(directory = defaultBackupDirectory, day = new Date().toISOString().slice(0, 10)) {
  return resolve(directory, `root-daily-${day}.sqlite`)
}

export function createDailyDatabaseBackup(database: Database, directory = defaultBackupDirectory,
  day = new Date().toISOString().slice(0, 10)) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const finalPath = dailyBackupPath(directory, day)
  if (existsSync(finalPath)) {
    verifyDatabaseFile(finalPath)
    pruneBackups(directory)
    return { path: finalPath, created: false }
  }
  const temporaryPath = `${finalPath}.${process.pid}.tmp`
  const escapedPath = temporaryPath.replaceAll('\'', '\'\'')
  try {
    database.run(`VACUUM INTO '${escapedPath}'`)
    chmodSync(temporaryPath, 0o600)
    verifyDatabaseFile(temporaryPath)
    // A same-host second process may have won the daily race while this snapshot was being made.
    if (!existsSync(finalPath)) renameSync(temporaryPath, finalPath)
    else rmSync(temporaryPath, { force: true })
    chmodSync(finalPath, 0o600)
    verifyDatabaseFile(finalPath)
    pruneBackups(directory)
    return { path: finalPath, created: true }
  }
  finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function restoreDatabase(livePath: string, backupPath: string, backupDirectory = defaultBackupDirectory) {
  const live = resolve(livePath)
  const source = resolve(backupPath)
  if (live === source) throw new Error('Backup and live database paths must differ')
  verifyDatabaseFile(source)

  let safetyBackup: string | null = null
  if (existsSync(live)) {
    const current = new Database(live, { readonly: true, strict: true })
    try {
      safetyBackup = createDatabaseBackup(current, { directory: backupDirectory, kind: 'pre-restore' })
    }
    finally {
      current.close()
    }
  }

  mkdirSync(dirname(live), { recursive: true })
  const temporary = `${live}.restore-${timestamp()}.tmp`
  copyFileSync(source, temporary)
  chmodSync(temporary, 0o600)
  verifyDatabaseFile(temporary)

  const retired = `${live}.replaced-${timestamp()}`
  const moved: Array<[string, string]> = []
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = live + suffix
      if (!existsSync(from)) continue
      const to = retired + suffix
      renameSync(from, to)
      moved.push([from, to])
    }
    renameSync(temporary, live)
    verifyDatabaseFile(live)
    for (const [, path] of moved) rmSync(path, { force: true })
  }
  catch (error) {
    rmSync(live, { force: true })
    for (const [original, movedPath] of moved.reverse()) {
      if (existsSync(movedPath)) renameSync(movedPath, original)
    }
    rmSync(temporary, { force: true })
    throw error
  }
  return { restoredFrom: source, safetyBackup, filename: basename(live) }
}
