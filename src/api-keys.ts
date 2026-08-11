import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'

export const API_KEY_PREFIX = 'tlk_'
export const apiKeyHash = (value: string) => createHash('sha256').update(value).digest('hex')

export function issueApiKey(database: Database, userId: number, name: string, expiresAt: number | null,
  now = Date.now())
{
  const value = API_KEY_PREFIX + randomBytes(32).toString('base64url')
  const result = database.query(`INSERT INTO api_keys(token_hash,user_id,name,created_at,expires_at)
    VALUES(?,?,?,?,?)`).run(apiKeyHash(value), userId, name, now, expiresAt)
  return { id: Number(result.lastInsertRowid), value }
}

export function userForApiKey(database: Database, value: string | null, now = Date.now()) {
  if (!value?.startsWith(API_KEY_PREFIX)) return null
  const row = database.query(`SELECT u.id,u.handle,u.email,u.bio,u.suspended_at,u.email_verified_at,u.handle_chosen_at,
      k.id key_id
    FROM api_keys k JOIN users u ON u.id=k.user_id
    WHERE k.token_hash=? AND (k.expires_at IS NULL OR k.expires_at>?)
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(apiKeyHash(value), now) as ({ id: number; handle: string; email: string; bio: string;
      suspended_at?: string | null; email_verified_at?: string | null; handle_chosen_at?: string | null;
      key_id: number }) | null
  if (!row) return null
  database.query('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now, row.key_id)
  const { key_id: _, ...user } = row
  return user
}
