import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'

export function issueInteractedUnsubscribeToken(database: Database, userId: number) {
  const value = token()
  database.query('INSERT INTO interacted_unsubscribe_tokens(token_hash,user_id) VALUES(?,?)').run(hash(value), userId)
  return value
}

