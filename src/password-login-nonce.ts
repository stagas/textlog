import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'

export const PASSWORD_LOGIN_NONCE_LIFETIME_MS = 10 * 60 * 1000

function nonceHash(value: string, address: string) {
  return hash(`textlog password login nonce\0${address}\0${value}`)
}

export function issuePasswordLoginNonce(database: Database, address: string, now = Date.now()) {
  const value = token()
  database.query('INSERT INTO password_login_nonces(token_hash,expires_at) VALUES(?,?)')
    .run(nonceHash(value, address), now + PASSWORD_LOGIN_NONCE_LIFETIME_MS)
  return value
}

export function consumePasswordLoginNonce(database: Database, value: string, address: string, now = Date.now()) {
  if (!value) return false
  return database.transaction(() => {
    const key = nonceHash(value, address)
    const valid = database.query('SELECT 1 FROM password_login_nonces WHERE token_hash=? AND expires_at>?')
      .get(key, now)
    if (!valid) return false
    database.query('DELETE FROM password_login_nonces WHERE token_hash=?').run(key)
    return true
  })()
}
