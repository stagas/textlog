import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { recordAdminAction } from './admin'
import { initializeLatestReads } from './latest-state'

export type ResolvedHandle = { id: number; handle: string; alias: boolean }

export class HandleChangeLimitError extends Error {
  constructor() {
    super('Handle changes are limited to two per month')
    this.name = 'HandleChangeLimitError'
  }
}

function bannedHandle(database: Database, handle: string) {
  return Boolean(database.query('SELECT 1 FROM banned_usernames WHERE username=? COLLATE NOCASE').get(handle))
}

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
    if (bannedHandle(database, handle)) throw new Error('Handle is banned')
    if (database.query('SELECT 1 FROM handle_history WHERE handle=? COLLATE NOCASE').get(handle)) {
      throw new Error('Handle is reserved')
    }
    const created = database.query('INSERT INTO users(handle,email,password) VALUES(?,?,?) RETURNING id')
      .get(handle, email, password) as { id: number }
    initializeLatestReads(created.id, database)
    return created
  })()
}

function handleHistoryHasGroups(database: Database) {
  return (database.query('PRAGMA table_info(handle_history)').all() as { name: string }[])
    .some(column => column.name === 'account_group_id')
}

function historicalHandleClaim(database: Database, userId: number, handle: string) {
  const groupAware = handleHistoryHasGroups(database)
  const historical = database.query(`SELECT hh.user_id,u.deleted_at${
    groupAware
      ? ',hh.account_group_id,claimant.account_group_id claimant_group_id'
      : ''
  }
    FROM handle_history hh JOIN users u ON u.id=hh.user_id
    ${groupAware ? 'JOIN users claimant ON claimant.id=?' : ''}
    WHERE hh.handle=? COLLATE NOCASE`).get(...(groupAware ? [userId, handle] : [handle])) as {
    user_id: number
    deleted_at: string | null
    account_group_id?: number | null
    claimant_group_id?: number | null
  } | null
  if (!historical || historical.user_id === userId) return { allowed: true, reclaimed: false }
  const reclaimed = Boolean(historical.deleted_at && historical.account_group_id
    && historical.account_group_id === historical.claimant_group_id)
  return { allowed: reclaimed, reclaimed }
}

export function claimInitialHandle(database: Database, userId: number, handle: string,
  onClaim?: (reclaimed: boolean) => void)
{
  return database.transaction(() => {
    if (bannedHandle(database, handle)) throw new Error('Handle is banned')
    if (database.query('SELECT 1 FROM users WHERE handle=? COLLATE NOCASE AND id!=? AND deleted_at IS NULL')
      .get(handle, userId)) throw new Error('Handle is unavailable')
    const claim = historicalHandleClaim(database, userId, handle)
    if (!claim.allowed) throw new Error('Handle is reserved')
    onClaim?.(claim.reclaimed)
    if (handleHistoryHasGroups(database)) {
      database.query(`UPDATE handle_history SET user_id=?,account_group_id=(
        SELECT account_group_id FROM users WHERE id=?) WHERE handle=? COLLATE NOCASE`).run(userId, userId, handle)
    }
    database.query('UPDATE users SET handle=?,handle_chosen_at=CURRENT_TIMESTAMP WHERE id=?').run(handle, userId)
    if (claim.reclaimed && database.query(
      'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'account_creation_events\'',
    ).get()) {
      database.query('DELETE FROM account_creation_events WHERE user_id=?').run(userId)
    }
    return claim
  })()
}

export function updateProfileHandle(database: Database, userId: number, handle: string, bio: string) {
  return database.transaction(() => {
    const account = database.query('SELECT handle FROM users WHERE id=? AND deleted_at IS NULL').get(userId) as
      | { handle: string }
      | null
    if (!account) throw new Error('Account not found')

    if (account.handle.toLowerCase() !== handle.toLowerCase()) {
      if (bannedHandle(database, handle)) throw new Error('Handle is banned')
      const changesThisMonth = database.query(`SELECT COUNT(*) count FROM handle_change_events
        WHERE user_id=? AND changed_at>=datetime('now','start of month')
          AND changed_at<datetime('now','start of month','+1 month')`).get(userId) as { count: number }
      if (changesThisMonth.count >= 2) throw new HandleChangeLimitError()

      const currentOwner = database.query(
        'SELECT id FROM users WHERE handle=? COLLATE NOCASE AND deleted_at IS NULL',
      ).get(handle) as { id: number } | null
      if (currentOwner && currentOwner.id !== userId) throw new Error('Handle is unavailable')

      const claim = historicalHandleClaim(database, userId, handle)
      if (!claim.allowed) throw new Error('Handle is reserved')

      if (handleHistoryHasGroups(database)) {
        database.query(`UPDATE handle_history SET user_id=?,account_group_id=(
          SELECT account_group_id FROM users WHERE id=?) WHERE handle=? COLLATE NOCASE`).run(userId, userId, handle)
      }

      database.query('INSERT OR IGNORE INTO handle_history(handle,user_id) VALUES(?,?)')
        .run(account.handle.toLowerCase(), userId)
      database.query('INSERT INTO handle_change_events(user_id) VALUES(?)').run(userId)
      if (claim.reclaimed && database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'account_creation_events\'',
      ).get()) {
        database.query('DELETE FROM account_creation_events WHERE user_id=?').run(userId)
      }
    }

    database.query('UPDATE users SET handle=?,bio=? WHERE id=?').run(handle, bio, userId)
  })()
}

export function dropUsername(database: Database, userId: number, actorId: number, note: string) {
  return database.transaction(() => {
    const account = database.query('SELECT handle FROM users WHERE id=? AND deleted_at IS NULL').get(userId) as
      | { handle: string }
      | null
    if (!account) return { status: 'not_found' as const }
    if (bannedHandle(database, account.handle)) return { status: 'already_banned' as const }
    database.query(`INSERT INTO banned_usernames(username,dropped_user_id,dropped_by,note)
      VALUES(?,?,?,?)`).run(account.handle.toLowerCase(), userId, actorId, note.trim().slice(0, 500))
    database.query('DELETE FROM handle_history WHERE handle=? COLLATE NOCASE').run(account.handle)
    let temporaryHandle = ''
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `anon${randomBytes(6).toString('hex')}`
      if (database.query('SELECT 1 FROM users WHERE handle=? COLLATE NOCASE').get(candidate)) continue
      if (bannedHandle(database, candidate)) continue
      temporaryHandle = candidate
      break
    }
    if (!temporaryHandle) throw new Error('Could not allocate temporary handle')
    database.query('UPDATE users SET handle=?,handle_chosen_at=NULL WHERE id=?').run(temporaryHandle, userId)
    recordAdminAction(database, actorId, 'drop_username', userId, null, note)
    return { status: 'ready' as const, username: account.handle, temporaryHandle }
  })()
}

export function excludesDroppedUsernameUsers(database: Database, userAlias = 'u') {
  const supported = database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='banned_usernames'",
  ).get()
  return supported
    ? `NOT EXISTS (SELECT 1 FROM banned_usernames hidden_author WHERE hidden_author.dropped_user_id=${userAlias}.id)`
    : '1'
}
