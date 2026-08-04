import { Database } from 'bun:sqlite'
import { createDatabaseBackup, defaultBackupDirectory, defaultDatabasePath } from '../src/database-backup'

const database = new Database(defaultDatabasePath, { readonly: true, strict: true })
try {
  const backup = createDatabaseBackup(database, { directory: defaultBackupDirectory, kind: 'manual' })
  console.log(`Database backup created and verified: ${backup}`)
}
finally {
  database.close()
}
