import { Database } from 'bun:sqlite'
import { createDatabaseBackup, defaultBackupDirectory, defaultDatabasePath } from './database-backup'
import { compactDatabaseAfterMigration } from './database-compaction'
import { hotScoresNeedRebuild, rebuildHotPosts } from './hot'
import { databaseVersion, latestMigrationVersion, runMigrations } from './migrations'
export type { User } from './types'

export const db = new Database(defaultDatabasePath, { create: true, strict: true })
const busyTimeoutMs = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
const cacheKiB = Math.max(2_000, Math.min(262_144, Number(Bun.env.DATABASE_CACHE_KIB || 32_768)))
const mmapBytes = Math.max(0, Math.min(1_073_741_824, Number(Bun.env.DATABASE_MMAP_BYTES || 134_217_728)))
db.run(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=1000;
  PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-${cacheKiB};
  PRAGMA mmap_size=${mmapBytes}; PRAGMA busy_timeout=${busyTimeoutMs};`)

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
if (hotScoresNeedRebuild(db)) rebuildHotPosts(db)
db.query('PRAGMA wal_checkpoint(TRUNCATE)').get()
if (startingVersion < latestMigrationVersion && hasUserTables) compactDatabaseAfterMigration(db, defaultDatabasePath)

// Long-retention moderation records are pruned at startup; high-churn tables use periodic bounded maintenance.
db.query('DELETE FROM illegal_activity_reports WHERE status!=\'open\' AND resolved_at<datetime(\'now\',\'-3 years\')')
  .run()
db.query('DELETE FROM reports WHERE status!=\'open\' AND resolved_at<datetime(\'now\',\'-3 years\')').run()
db.query('DELETE FROM admin_actions WHERE created_at<datetime(\'now\',\'-3 years\')').run()
