import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { insertSession, markSessionUsed, migrateLegacySessionTokens, onlineUserCount, renewSession, SESSION_LIFETIME_MS,
  SESSION_RENEWAL_WINDOW_MS, sessionHash } from './sessions'

describe('session token storage', () => {
  test('hashes new session tokens before insertion', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
      created_at INTEGER,user_agent TEXT,last_used_at INTEGER)`)
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
        created_at INTEGER,user_agent TEXT,last_used_at INTEGER);
      INSERT INTO sessions VALUES('existing-browser-token',3,2000,1000,'Test Browser',1000)`)

    migrateLegacySessionTokens(database)

    const columns = database.query('PRAGMA table_info(sessions)').all() as { name: string }[]
    const stored = database.query('SELECT token_hash FROM sessions').get() as { token_hash: string }
    expect(columns.map(column => column.name)).toContain('token_hash')
    expect(columns.map(column => column.name)).not.toContain('token')
    expect(stored.token_hash).toBe(sessionHash('existing-browser-token'))
  })

  test('renews an active session for 365 days and throttles repeated writes', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
        created_at INTEGER,user_agent TEXT,last_used_at INTEGER);
      INSERT INTO users VALUES(7,NULL,NULL)`)
    const now = 1_000_000
    insertSession(database, 'active-token', 7, now + 30 * 24 * 60 * 60 * 1000, now, 'Test Browser')

    expect(renewSession(database, 'active-token', now)).toBe(true)
    expect(database.query('SELECT expires_at FROM sessions').get()).toEqual({ expires_at: now + SESSION_LIFETIME_MS })
    expect(renewSession(database, 'active-token', now + SESSION_RENEWAL_WINDOW_MS / 2)).toBe(false)
  })

  test('does not renew expired or suspended sessions', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
        created_at INTEGER,user_agent TEXT,last_used_at INTEGER);
      INSERT INTO users VALUES(7,NULL,NULL),(8,NULL,'2026-01-01')`)
    insertSession(database, 'expired-token', 7, 999, 1, 'Test Browser')
    insertSession(database, 'suspended-token', 8, 2000, 1, 'Test Browser')

    expect(renewSession(database, 'expired-token', 1000)).toBe(false)
    expect(renewSession(database, 'suspended-token', 1000)).toBe(false)
  })

  test('counts distinct active users in the rolling 30-minute window', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,deleted_at TEXT,suspended_at TEXT);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER,
        created_at INTEGER,user_agent TEXT,last_used_at INTEGER);
      INSERT INTO users VALUES(1,NULL,NULL),(2,NULL,NULL),(3,NULL,'2026-01-01')`)
    const now = 2_000_000
    insertSession(database, 'one-a', 1, now + 1000, now - 1000, '')
    insertSession(database, 'one-b', 1, now + 1000, now - 2000, '')
    insertSession(database, 'old', 2, now + 1000, now - 30 * 60 * 1000 - 1, '')
    insertSession(database, 'suspended', 3, now + 1000, now, '')

    expect(onlineUserCount(database, now)).toBe(1)
    expect(markSessionUsed(database, 'old', now)).toBe(true)
    expect(onlineUserCount(database, now)).toBe(2)
  })
})
