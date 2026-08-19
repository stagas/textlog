import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import type { User } from './types'

export const feedKeyHash = (value: string) => createHash('sha256').update(value).digest('hex')

export function issueFeedKey(database: Database, userId: number, name: string, expiresAt: number | null,
  now = Date.now())
{
  const value = randomBytes(32).toString('hex')
  const result = database.query(`INSERT INTO feed_keys(token_hash,user_id,name,created_at,expires_at)
    VALUES(?,?,?,?,?)`).run(feedKeyHash(value), userId, name, now, expiresAt)
  return { id: Number(result.lastInsertRowid), value }
}

export function userForFeedKey(database: Database, value: string | null, now = Date.now()): User | null {
  // Continue accepting previously issued base64url keys while new keys use plain hexadecimal.
  if (!value || !(/^[a-f0-9]{64}$/.test(value) || /^tlf_[A-Za-z0-9_-]{43}$/.test(value))) return null
  const row = database.query(`SELECT u.id,u.handle,u.email,u.bio,u.suspended_at,u.email_verified_at,u.handle_chosen_at,
      u.is_bot,u.bot_managed,u.timezone,u.show_link_previews,k.id key_id
    FROM feed_keys k JOIN users u ON u.id=k.user_id
    WHERE k.token_hash=? AND (k.expires_at IS NULL OR k.expires_at>?)
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(feedKeyHash(value), now) as (User & { key_id: number }) | null
  if (!row) return null
  database.query('UPDATE feed_keys SET last_used_at=? WHERE id=?').run(now, row.key_id)
  const { key_id: _, ...user } = row
  return user
}
