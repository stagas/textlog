import { Database } from 'bun:sqlite'
import { defaultBackupDirectory, defaultDatabasePath, restoreDatabase, verifyDatabaseFile } from '../src/database-backup'
import { latestMigrationVersion, runMigrations } from '../src/migrations'

const args = Bun.argv.slice(2)
const backup = args.find(argument => !argument.startsWith('--'))
if (!backup || !args.includes('--confirm')) {
  console.error('Usage: bun run db:restore -- <backup.sqlite> --confirm\nStop the application before restoring.')
  process.exit(1)
}
const source = verifyDatabaseFile(backup)
if (source.version > latestMigrationVersion) {
  throw new Error(`Backup version ${source.version} is newer than supported version ${latestMigrationVersion}`)
}

const result = restoreDatabase(defaultDatabasePath, backup, defaultBackupDirectory)
const database = new Database(defaultDatabasePath, { create: true, strict: true })
try {
  database.run('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
  runMigrations(database, migration => console.log(`database migrate v${migration.version} ${migration.name}`))
  database.query('PRAGMA wal_checkpoint(TRUNCATE)').get()
}
finally {
  database.close()
}
console.log(`Database restored and verified from ${result.restoredFrom}`)
if (result.safetyBackup) console.log(`Replaced database safety backup: ${result.safetyBackup}`)
