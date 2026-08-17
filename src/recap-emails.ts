import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'

export function issueRecapUnsubscribeToken(database: Database, userId: number) {
  const value = token()
  database.query('INSERT INTO recap_unsubscribe_tokens(token_hash,user_id) VALUES(?,?)').run(hash(value), userId)
  return value
}

export function accountForRecapToken(database: Database, value: string) {
  if (!value) return null
  return database.query(`SELECT u.id,u.handle,u.email,u.bio,u.recap_emails FROM recap_unsubscribe_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND u.deleted_at IS NULL`).get(hash(value)) as
    | { id: number; handle: string; email: string; bio: string; recap_emails: number }
    | null
}
