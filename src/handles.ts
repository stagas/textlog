import type { Database } from 'bun:sqlite'

export type ResolvedHandle = { id: number; handle: string; alias: boolean }

export function resolveHandle(database: Database, requestedHandle: string): ResolvedHandle | null {
  const current = database.query(
    'SELECT id,handle FROM users WHERE handle=? COLLATE NOCASE AND deleted_at IS NULL',
  ).get(requestedHandle) as { id: number; handle: string } | null
  if (current) return { ...current, alias: false }

  const historical = database.query(`SELECT u.id,u.handle FROM handle_history hh
    JOIN users u ON u.id=hh.user_id
    WHERE hh.handle=? COLLATE NOCASE AND u.deleted_at IS NULL`).get(requestedHandle) as
    | { id: number; handle: string }
    | null
  return historical ? { ...historical, alias: true } : null
}

export function createAccount(database: Database, handle: string, email: string, password: string) {
  return database.transaction(() => {
    if (database.query('SELECT 1 FROM handle_history WHERE handle=? COLLATE NOCASE').get(handle)) {
      throw new Error('Handle is reserved')
    }
    return database.query('INSERT INTO users(handle,email,password) VALUES(?,?,?) RETURNING id')
      .get(handle, email, password) as { id: number }
  })()
}

export function updateProfileHandle(database: Database, userId: number, handle: string, bio: string) {
  return database.transaction(() => {
    const account = database.query('SELECT handle FROM users WHERE id=? AND deleted_at IS NULL').get(userId) as
      | { handle: string }
      | null
    if (!account) throw new Error('Account not found')

    if (account.handle.toLowerCase() !== handle.toLowerCase()) {
      const currentOwner = database.query(
        'SELECT id FROM users WHERE handle=? COLLATE NOCASE AND deleted_at IS NULL',
      ).get(handle) as { id: number } | null
      if (currentOwner && currentOwner.id !== userId) throw new Error('Handle is unavailable')

      const historicalOwner = database.query(
        'SELECT user_id FROM handle_history WHERE handle=? COLLATE NOCASE',
      ).get(handle) as { user_id: number } | null
      if (historicalOwner && historicalOwner.user_id !== userId) throw new Error('Handle is reserved')

      database.query('INSERT OR IGNORE INTO handle_history(handle,user_id) VALUES(?,?)')
        .run(account.handle.toLowerCase(), userId)
    }

    database.query('UPDATE users SET handle=?,bio=? WHERE id=?').run(handle, bio, userId)
  })()
}
