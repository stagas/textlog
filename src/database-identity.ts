import type { Database } from 'bun:sqlite'

export const DATABASE_IDENTITY = Symbol('textlog.databaseIdentity')

export function databaseIdentity(database: Database) {
  return (database as Database & { [DATABASE_IDENTITY]?: Database })[DATABASE_IDENTITY] || database
}
