import { Database } from 'bun:sqlite'
import { createDatabaseBackup, defaultBackupDirectory, defaultDatabasePath } from './database-backup'
import { databaseVersion, latestMigrationVersion, runMigrations } from './migrations'

export const db = new Database(defaultDatabasePath, { create: true, strict: true })
const busyTimeoutMs = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
db.run(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=1000;
  PRAGMA busy_timeout=${busyTimeoutMs};`)

const startingVersion = databaseVersion(db)
const hasUserTables = !!db.query(
  'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' LIMIT 1',
).get()
if (startingVersion < latestMigrationVersion && hasUserTables) {
  const backup = createDatabaseBackup(db, {
    directory: defaultBackupDirectory,
    kind: 'pre-migration',
    label: `v${startingVersion}-to-v${latestMigrationVersion}`,
  })
  console.log(`database backup  ${backup}`)
}

runMigrations(db, migration => console.log(`database migrate v${migration.version} ${migration.name}`))
db.query('PRAGMA wal_checkpoint(TRUNCATE)').get()

export type User = { id: number; handle: string; email: string; bio: string; suspended_at?: string | null;
  email_verified_at?: string | null; activity_read_at?: string | null; handle_chosen_at?: string | null;
  api_writes_enabled_at?: string | null }

// Long-retention moderation records are pruned at startup; high-churn tables use periodic bounded maintenance.
db.query('DELETE FROM illegal_activity_reports WHERE status!=\'open\' AND resolved_at<datetime(\'now\',\'-3 years\')')
  .run()
db.query('DELETE FROM reports WHERE status!=\'open\' AND resolved_at<datetime(\'now\',\'-3 years\')').run()
db.query('DELETE FROM admin_actions WHERE created_at<datetime(\'now\',\'-3 years\')').run()
