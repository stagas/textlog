import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'

export function issuePasswordEnableToken(database: Database, userId: number, email: string, now = Date.now()) {
  const value = token()
  database.query('DELETE FROM password_enable_tokens WHERE user_id=? OR expires_at<=?').run(userId, now)
  database.query('INSERT INTO password_enable_tokens(token_hash,user_id,email,expires_at) VALUES(?,?,?,?)')
    .run(hash(value), userId, email, now + 3600000)
  return value
}

export function accountForPasswordEnableToken(database: Database, value: string, now = Date.now()) {
  if (!value) return null
  return database.query(`SELECT u.id,u.email FROM password_enable_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.expires_at>? AND u.deleted_at IS NULL AND u.password='!'
      AND u.email=t.email`).get(hash(value), now) as { id: number; email: string } | null
}
