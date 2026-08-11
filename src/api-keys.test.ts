import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { apiKeyHash, API_KEY_PREFIX, issueApiKey, userForApiKey } from './api-keys'

function fixture() {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT,
      deleted_at TEXT,suspended_at TEXT,email_verified_at TEXT,handle_chosen_at TEXT);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,last_used_at INTEGER);
    INSERT INTO users VALUES(1,'alice','alice@example.com','',NULL,NULL,'2026-01-01','2026-01-01');`)
  return database
}

describe('API keys', () => {
  test('stores only a hash and authenticates the generated bearer key', () => {
    const database = fixture()
    const issued = issueApiKey(database, 1, 'deploy bot', null, 1_000)
    const stored = database.query('SELECT token_hash,last_used_at FROM api_keys WHERE id=?')
      .get(issued.id) as { token_hash: string; last_used_at: number | null }

    expect(issued.value).toStartWith(API_KEY_PREFIX)
    expect(stored.token_hash).toBe(apiKeyHash(issued.value))
    expect(stored.token_hash).not.toContain(issued.value)
    expect(userForApiKey(database, issued.value, 2_000)?.handle).toBe('alice')
    expect(database.query('SELECT last_used_at FROM api_keys WHERE id=?').get(issued.id))
      .toEqual({ last_used_at: 2_000 })
  })

  test('rejects expired, revoked, malformed, and suspended-account keys', () => {
    const database = fixture()
    const expired = issueApiKey(database, 1, 'old', 1_500, 1_000)
    expect(userForApiKey(database, expired.value, 1_500)).toBeNull()

    const revoked = issueApiKey(database, 1, 'revoked', null, 1_000)
    database.query('DELETE FROM api_keys WHERE id=?').run(revoked.id)
    expect(userForApiKey(database, revoked.value, 2_000)).toBeNull()
    expect(userForApiKey(database, 'not-an-api-key', 2_000)).toBeNull()

    const suspended = issueApiKey(database, 1, 'suspended', null, 1_000)
    database.query("UPDATE users SET suspended_at='2026-01-01' WHERE id=1").run()
    expect(userForApiKey(database, suspended.value, 2_000)).toBeNull()
  })
})
