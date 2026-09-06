export const accountDeletionReasons = [
  ['not_using', 'I don’t use textlog often enough'],
  ['taking_break', 'I’m taking a break from social platforms'],
  ['missing_features', 'It’s missing features I need'],
  ['hard_to_use', 'I find it difficult or confusing to use'],
  ['community_fit', 'The community isn’t the right fit for me'],
  ['content', 'I’m not finding content that interests me'],
  ['experience', 'My overall experience hasn’t met my expectations'],
  ['other', 'Other'],
] as const

export function accountDeletionReason(value: string, other: string) {
  const option = accountDeletionReasons.find(([key]) => key === value)
  if (!option) return null
  const detail = other.trim().replace(/\s+/g, ' ')
  if (!detail) return option[1]
  return value === 'other' ? detail.slice(0, 500) : `${option[1]}: ${detail}`.slice(0, 500)
}

export function issueAccountDeletionToken(database: Database, userId: number, email: string, now = Date.now()) {
  const value = token()
  database.query('DELETE FROM account_deletion_tokens WHERE user_id=? OR expires_at<=?').run(userId, now)
  database.query('INSERT INTO account_deletion_tokens(token_hash,user_id,email,expires_at) VALUES(?,?,?,?)')
    .run(hash(value), userId, email, now + 3600000)
  return value
}

export function accountForDeletionToken(database: Database, value: string, now = Date.now()) {
  if (!value) return null
  return database.query(`SELECT u.id,u.email FROM account_deletion_tokens t
    JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.expires_at>? AND u.deleted_at IS NULL AND u.password='!'
      AND u.email=t.email`).get(hash(value), now) as { id: number; email: string } | null
}
import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'
