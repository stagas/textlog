import type { Database } from 'bun:sqlite'
import { hash, token } from './utils'

export function issueEmailChangeAuthorization(database: Database, userId: number, currentEmail: string,
  newEmail: string, now = Date.now())
{
  const value = token()
  database.query('DELETE FROM email_change_authorizations WHERE user_id=? OR expires_at<=?').run(userId, now)
  database.query(`INSERT INTO email_change_authorizations(token_hash,user_id,current_email,new_email,expires_at)
    VALUES(?,?,?,?,?)`).run(hash(value), userId, currentEmail, newEmail, now + 3600000)
  return value
}

export function emailChangeForToken(database: Database, value: string, now = Date.now()) {
  if (!value) return null
  return database.query(`SELECT a.user_id,a.new_email FROM email_change_authorizations a
    JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.expires_at>? AND u.deleted_at IS NULL
      AND u.password='!' AND u.email=a.current_email`).get(hash(value), now) as
    { user_id: number; new_email: string } | null
}
