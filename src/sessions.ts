import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
export const SESSION_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000

export function sessionHash(token: string): string
export function sessionHash(token: null | undefined): null
export function sessionHash(token: string | null | undefined): string | null
export function sessionHash(token: string | null | undefined) {
  return token === null || token === undefined ? null : hashToken(token)
}

export function insertSession(database: Database, token: string, userId: number, expiresAt: number, createdAt: number,
  userAgent: string)
{
  database.query('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,user_agent) VALUES(?,?,?,?,?)')
    .run(hashToken(token), userId, expiresAt, createdAt, userAgent)
}

export function renewSession(database: Database, token: string, now = Date.now()) {
  const expiresAt = now + SESSION_LIFETIME_MS
  const result = database.query(`UPDATE sessions SET expires_at=?
    WHERE token_hash=? AND expires_at>? AND expires_at<?
      AND EXISTS (SELECT 1 FROM users WHERE users.id=sessions.user_id
        AND users.deleted_at IS NULL AND users.suspended_at IS NULL)`)
    .run(expiresAt, hashToken(token), now, expiresAt - SESSION_RENEWAL_WINDOW_MS)
  return result.changes > 0
}

export function migrateLegacySessionTokens(database: Database) {
  const columns = database.query('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!columns.some(column => column.name === 'token') || columns.some(column => column.name === 'token_hash')) return

  const sessions = database.query('SELECT token FROM sessions').all() as { token: string }[]
  database.transaction(() => {
    const replace = database.query('UPDATE sessions SET token=? WHERE token=?')
    for (const session of sessions) replace.run(hashToken(session.token), session.token)
    database.run('ALTER TABLE sessions RENAME COLUMN token TO token_hash')
  })()
}
