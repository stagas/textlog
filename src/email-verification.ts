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
        database.query('UPDATE users SET email=?,email_verified_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(record.email, record.user_id)
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
