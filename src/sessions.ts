import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
export const SESSION_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000
export const ONLINE_WINDOW_MS = 30 * 60 * 1000

export function sessionHash(token: string): string
export function sessionHash(token: null | undefined): null
export function sessionHash(token: string | null | undefined): string | null
export function sessionHash(token: string | null | undefined) {
  return token === null || token === undefined ? null : hashToken(token)
}

export function insertSession(database: Database, token: string, userId: number, expiresAt: number, createdAt: number,
  userAgent: string)
{
  database.query(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at,user_agent,last_used_at)
    VALUES(?,?,?,?,?,?)`).run(hashToken(token), userId, expiresAt, createdAt, userAgent, createdAt)
}

export function markSessionUsed(database: Database, token: string, now = Date.now()) {
  return database.query(`UPDATE sessions SET last_used_at=?
    WHERE token_hash=? AND expires_at>?
      AND EXISTS (SELECT 1 FROM users WHERE users.id=sessions.user_id
        AND users.deleted_at IS NULL AND users.suspended_at IS NULL)`)
    .run(now, hashToken(token), now).changes > 0
}

export function onlineUserCount(database: Database, now = Date.now(), windowMs = ONLINE_WINDOW_MS) {
  return (database.query(`SELECT count(DISTINCT s.user_id) count
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.last_used_at>=? AND s.expires_at>?
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(now - windowMs, now) as { count: number }).count
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
