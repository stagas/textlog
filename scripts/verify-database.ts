import { Database } from 'bun:sqlite'
import { defaultDatabasePath, verifyDatabaseFile } from '../src/database-backup'

const result = verifyDatabaseFile(defaultDatabasePath)
const database = new Database(defaultDatabasePath, { readonly: true, strict: true })
try {
  const foreignKeys = database.query('PRAGMA foreign_key_check').all()
  if (foreignKeys.length) throw new Error(`Foreign-key check failed: ${JSON.stringify(foreignKeys)}`)
}
finally {
  database.close()
}
console.log(`Database verified: ${defaultDatabasePath} (schema version ${result.version})`)
