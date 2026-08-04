import type { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createDailyDatabaseBackup, pruneBackups, restoreDatabase, verifyDatabaseFile } from './database-backup'

export const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000

type BackupConfiguration = {
  directory: string
  alertWebhookUrl?: string | null
}

function quarterId(at: Date) {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`
}

async function alertFailure(configuration: BackupConfiguration, error: unknown, fetcher: typeof fetch) {
  console.error('automated backup failed', error)
  if (!configuration.alertWebhookUrl) return
  try {
    const response = await fetcher(configuration.alertWebhookUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ event: 'database_backup_failed', service: 'root.mx', error: String(error),
        occurredAt: new Date().toISOString() }),
    })
    if (!response.ok) console.error(`backup alert webhook returned ${response.status}`)
  }
  catch (alertError) { console.error('backup alert delivery failed', alertError) }
}

function restoreDrill(configuration: BackupConfiguration, backupPath: string, backupCreatedAt: number, now: Date) {
  const id = quarterId(now)
  const reportPath = join(configuration.directory, 'drills', `${id}.json`)
  if (existsSync(reportPath)) return null
  const started = performance.now()
  const drillDirectory = join(configuration.directory, '.restore-drill')
  const restored = join(drillDirectory, `${id}-restored.sqlite`)
  mkdirSync(drillDirectory, { recursive: true, mode: 0o700 })
  try {
    restoreDatabase(restored, backupPath, drillDirectory)
    const verified = verifyDatabaseFile(restored)
    const report = {
      quarter: id,
      performedAt: now.toISOString(),
      sourceBackup: backupPath,
      rpoSeconds: Math.max(0, Math.round((now.getTime() - backupCreatedAt) / 1000)),
      rtoMilliseconds: Math.round((performance.now() - started) * 100) / 100,
      databaseVersion: verified.version,
      status: 'passed',
    }
    mkdirSync(dirname(reportPath), { recursive: true, mode: 0o700 })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    return report
  }
  finally { rmSync(drillDirectory, { recursive: true, force: true }) }
}

export async function runAutomatedBackup(database: Database, configuration: BackupConfiguration,
  now = new Date(), fetcher: typeof fetch = fetch) {
  try {
    pruneBackups(configuration.directory, now.getTime())
    const day = now.toISOString().slice(0, 10)
    const local = createDailyDatabaseBackup(database, configuration.directory, day)
    const drill = restoreDrill(configuration, local.path, statSync(local.path).mtimeMs, now)
    return { day, path: local.path, created: local.created, drill }
  }
  catch (error) {
    await alertFailure(configuration, error, fetcher)
    throw error
  }
}

export function startAutomatedBackups(database: Database, configuration: BackupConfiguration) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await runAutomatedBackup(database, configuration) }
    catch {}
    finally { running = false }
  }
  void run()
  const timer = setInterval(run, BACKUP_CHECK_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
