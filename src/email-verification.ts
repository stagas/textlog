import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'

export type EmailTokenRecord = {
  token_hash: string
  user_id: number
  kind: 'verify' | 'change'
  email: string
}

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')

export function findEmailToken(database: Database, value: string, now = Date.now()) {
  if (!value) return null
  return database.query(`SELECT token_hash,user_id,kind,email FROM email_tokens
    WHERE token_hash=? AND expires_at>?`).get(tokenHash(value), now) as EmailTokenRecord | null
}

export function confirmEmailToken(database: Database, value: string, now = Date.now()):
  | { ok: true; kind: 'verify' | 'change' }
  | { ok: false; reason: 'invalid' | 'email_unavailable' }
{
  try {
    return database.transaction(() => {
      const record = findEmailToken(database, value, now)
      if (!record) return { ok: false as const, reason: 'invalid' as const }

      if (record.kind === 'change') {
        const groupsExist = !!database.query(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_groups'",
        ).get()
        const group = groupsExist
          ? database.query('SELECT account_group_id FROM users WHERE id=?').get(record.user_id) as
            | { account_group_id: number | null }
            | null
          : null
        if (group?.account_group_id) {
          if (database.query(`SELECT 1 FROM users WHERE email=? AND deleted_at IS NULL
            AND (account_group_id IS NULL OR account_group_id!=?)`).get(record.email, group.account_group_id)) {
            throw new Error('Email is unavailable')
          }
          database.query('UPDATE account_groups SET email=? WHERE id=?').run(record.email, group.account_group_id)
          database.query(`UPDATE users SET email=?,email_verified_at=CURRENT_TIMESTAMP
            WHERE account_group_id=?`).run(record.email, group.account_group_id)
        }
        else {
          database.query('UPDATE users SET email=?,email_verified_at=CURRENT_TIMESTAMP WHERE id=?')
            .run(record.email, record.user_id)
        }
      }
      else database.query('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?').run(record.user_id)
      database.query('DELETE FROM email_tokens WHERE user_id=?').run(record.user_id)
      return { ok: true as const, kind: record.kind }
    })()
  }
  catch {
    return { ok: false, reason: 'email_unavailable' }
  }
}
