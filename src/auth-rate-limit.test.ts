import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { authRateLimitMessage, consumeAuthAttempt, rateLimitKey } from './auth-rate-limit'

function database() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE auth_rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, key_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  )`)
  return db
}

describe('authentication rate limits', () => {
  test('rejects attempts after the limit and reports when the window reopens', () => {
    const db = database()
    const key = rateLimitKey('127.0.0.1')
    expect(consumeAuthAttempt(db, 'login', key, 2, 60, 1_000)).toBeNull()
    expect(consumeAuthAttempt(db, 'login', key, 2, 60, 2_000)).toBeNull()
    expect(consumeAuthAttempt(db, 'login', key, 2, 60, 3_000)).toEqual({ retryAfter: 58 })
    expect(consumeAuthAttempt(db, 'login', key, 2, 60, 62_000)).toBeNull()
  })

  test('isolates scopes and stores only hashed keys', () => {
    const db = database()
    const raw = 'person@example.com'
    const key = rateLimitKey(raw)
    consumeAuthAttempt(db, 'login', key, 1, 60, 1_000)
    expect(consumeAuthAttempt(db, 'forgot', key, 1, 60, 1_000)).toBeNull()
    expect(key).not.toContain(raw)
    expect((db.query('SELECT key_hash FROM auth_rate_limits LIMIT 1').get() as { key_hash: string }).key_hash).toBe(key)
  })

  test('provides a useful retry message', () => {
    expect(authRateLimitMessage(61)).toContain('about 2 minutes')
  })
})
