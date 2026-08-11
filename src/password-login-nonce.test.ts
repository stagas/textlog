import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { consumePasswordLoginNonce, issuePasswordLoginNonce, PASSWORD_LOGIN_NONCE_LIFETIME_MS }
  from './password-login-nonce'

function database() {
  const db = new Database(':memory:')
  db.run('CREATE TABLE password_login_nonces(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)')
  return db
}

test('password login nonces are hashed, address-bound, expiring, and single-use', () => {
  const db = database()
  const nonce = issuePasswordLoginNonce(db, '192.0.2.1', 1_000)
  const stored = db.query('SELECT token_hash FROM password_login_nonces').get() as { token_hash: string }
  expect(stored.token_hash).not.toContain(nonce)
  expect(consumePasswordLoginNonce(db, nonce, '192.0.2.2', 2_000)).toBe(false)
  expect(consumePasswordLoginNonce(db, nonce, '192.0.2.1', 2_000)).toBe(true)
  expect(consumePasswordLoginNonce(db, nonce, '192.0.2.1', 2_000)).toBe(false)

  const expired = issuePasswordLoginNonce(db, '192.0.2.1', 3_000)
  expect(consumePasswordLoginNonce(db, expired, '192.0.2.1', 3_000 + PASSWORD_LOGIN_NONCE_LIFETIME_MS)).toBe(false)
})
