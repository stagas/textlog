import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { insertSession, migrateLegacySessionTokens, sessionHash } from './sessions'

describe('session token storage', () => {
  test('hashes new session tokens before insertion', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
      created_at INTEGER,user_agent TEXT)`)
    const rawToken = 'browser-secret-token'

    insertSession(database, rawToken, 7, 2000, 1000, 'Test Browser')

    const stored = database.query('SELECT * FROM sessions').get() as { token_hash: string; user_id: number }
    expect(stored.token_hash).toBe(sessionHash(rawToken))
    expect(stored.token_hash).not.toBe(rawToken)
    expect(stored.user_id).toBe(7)
  })

  test('migrates legacy tokens without invalidating browser cookies', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE sessions (token TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
      created_at INTEGER,user_agent TEXT);
      INSERT INTO sessions VALUES('existing-browser-token',3,2000,1000,'Test Browser')`)

    migrateLegacySessionTokens(database)

    const columns = database.query('PRAGMA table_info(sessions)').all() as { name: string }[]
    const stored = database.query('SELECT token_hash FROM sessions').get() as { token_hash: string }
    expect(columns.map(column => column.name)).toContain('token_hash')
    expect(columns.map(column => column.name)).not.toContain('token')
    expect(stored.token_hash).toBe(sessionHash('existing-browser-token'))
  })
})
