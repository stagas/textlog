import type { Database } from 'bun:sqlite'

export const MONTHLY_NEW_ACCOUNT_LIMIT = 2

export type AccountGroup = {
  id: number
  email: string
  primary_user_id: number
  selected_user_id: number
}

export type AccountGroupUser = {
  id: number
  handle: string
  email: string
  bio: string
  password: string
  handle_chosen_at: string | null
  email_verified_at: string | null
  account_group_id: number | null
}

export type AccountChoice = Pick<AccountGroupUser, 'id' | 'handle' | 'handle_chosen_at'> & {
  primary: boolean
  selected: boolean
}

function accountGroupsAvailable(database: Database) {
  return !!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_groups'").get()
}

function groupForUser(database: Database, userId: number) {
  if (!accountGroupsAvailable(database)) return null
  return database.query(`SELECT g.id,g.email,g.primary_user_id,g.selected_user_id
    FROM users u JOIN account_groups g ON g.id=u.account_group_id WHERE u.id=?`).get(userId) as AccountGroup | null
}

/**
 * Normal application signups create their group immediately. This fallback also makes
 * accounts inserted by maintenance scripts safe to use after the migration.
 */
export function ensureAccountGroup(database: Database, userId: number) {
  if (!accountGroupsAvailable(database)) return null
  const existing = groupForUser(database, userId)
  if (existing) return existing
  const user = database.query(`SELECT id,email FROM users WHERE id=? AND deleted_at IS NULL`).get(userId) as
    | { id: number; email: string }
    | null
  if (!user) return null
  let group = database.query(`SELECT id,email,primary_user_id,selected_user_id
    FROM account_groups WHERE email=?`).get(user.email) as AccountGroup | null
  if (!group) {
    group = database.query(`INSERT INTO account_groups(email,primary_user_id,selected_user_id)
      VALUES(?,?,?) RETURNING id,email,primary_user_id,selected_user_id`)
      .get(user.email, user.id, user.id) as AccountGroup
  }
  database.query(`UPDATE users SET account_group_id=?
    WHERE email=? AND account_group_id IS NULL AND deleted_at IS NULL`).run(group.id, user.email)
  return group
}

export function createAccountGroup(database: Database, userId: number, email: string) {
  const group = database.query(`INSERT INTO account_groups(email,primary_user_id,selected_user_id)
    VALUES(?,?,?) RETURNING id,email,primary_user_id,selected_user_id`)
    .get(email, userId, userId) as AccountGroup
  database.query('UPDATE users SET account_group_id=? WHERE id=?').run(group.id, userId)
  return group
}

export function accountGroupForUser(database: Database, userId: number) {
  return groupForUser(database, userId) || ensureAccountGroup(database, userId)
}

export function isPrimaryAccount(database: Database, userId: number) {
  const group = accountGroupForUser(database, userId)
  return !group || group.primary_user_id === userId
}

function activeAccountQuery(where: string) {
  return `SELECT u.id,u.handle,u.email,u.bio,u.password,u.handle_chosen_at,u.email_verified_at,
      u.account_group_id
    FROM users u JOIN account_groups g ON g.id=u.account_group_id
    WHERE ${where} AND u.deleted_at IS NULL AND u.suspended_at IS NULL`
}

export function accountForEmail(database: Database, email: string) {
  if (!accountGroupsAvailable(database)) {
    return database.query(`SELECT id,handle,email,bio,'!' password,handle_chosen_at,email_verified_at,
      NULL account_group_id FROM users WHERE email=? AND handle_chosen_at IS NOT NULL
      AND deleted_at IS NULL AND suspended_at IS NULL`).get(email) as AccountGroupUser | null
  }
  let account = database.query(activeAccountQuery('g.email=?')
    + ' ORDER BY u.id=g.selected_user_id DESC,u.id=g.primary_user_id DESC,u.id LIMIT 1')
    .get(email) as AccountGroupUser | null
  if (account) return account

  const ungrouped = database.query(`SELECT id FROM users WHERE email=? AND account_group_id IS NULL
    AND deleted_at IS NULL AND suspended_at IS NULL ORDER BY id LIMIT 1`).get(email) as { id: number } | null
  if (!ungrouped) return null
  ensureAccountGroup(database, ungrouped.id)
  account = database.query(activeAccountQuery('g.email=?')
    + ' ORDER BY u.id=g.selected_user_id DESC,u.id=g.primary_user_id DESC,u.id LIMIT 1')
    .get(email) as AccountGroupUser | null
  return account
}

export function accountForHandle(database: Database, handle: string) {
  if (!accountGroupsAvailable(database)) {
    return database.query(`SELECT id,handle,email,bio,'!' password,handle_chosen_at,email_verified_at,
      NULL account_group_id FROM users WHERE handle=? COLLATE NOCASE AND handle_chosen_at IS NOT NULL
      AND deleted_at IS NULL AND suspended_at IS NULL`).get(handle) as AccountGroupUser | null
  }
  const row = database.query(`SELECT id FROM users WHERE handle=? COLLATE NOCASE AND handle_chosen_at IS NOT NULL
    AND deleted_at IS NULL AND suspended_at IS NULL`).get(handle) as { id: number } | null
  if (!row) return null
  ensureAccountGroup(database, row.id)
  return database.query(activeAccountQuery('u.id=?')).get(row.id) as AccountGroupUser | null
}

export function selectAccount(database: Database, userId: number) {
  if (!accountGroupsAvailable(database)) {
    return !!database.query(`SELECT 1 FROM users WHERE id=? AND deleted_at IS NULL AND suspended_at IS NULL`).get(userId)
  }
  const group = ensureAccountGroup(database, userId)
  if (!group) return false
  const active = database.query(`SELECT 1 FROM users WHERE id=? AND account_group_id=?
    AND deleted_at IS NULL AND suspended_at IS NULL`).get(userId, group.id)
  if (!active) return false
  database.query('UPDATE account_groups SET selected_user_id=? WHERE id=?').run(userId, group.id)
  return true
}

export function accountChoices(database: Database, userId: number) {
  const group = ensureAccountGroup(database, userId)
  if (!group) return []
  type AccountChoiceRow = Pick<AccountGroupUser, 'id' | 'handle' | 'handle_chosen_at'> & {
    is_primary: number
    is_selected: number
  }
  return (database.query(`SELECT u.id,u.handle,u.handle_chosen_at,
      u.id=g.primary_user_id is_primary,u.id=g.selected_user_id is_selected
    FROM users u JOIN account_groups g ON g.id=u.account_group_id
    WHERE g.id=? AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    ORDER BY is_primary DESC,u.created_at,u.id`).all(group.id) as AccountChoiceRow[])
    .map(({ is_primary, is_selected, ...account }) => ({ ...account,
      primary: Boolean(is_primary), selected: Boolean(is_selected) }))
}

export function recentAccountCreations(database: Database, groupId: number) {
  return (database.query(`SELECT COUNT(*) count FROM account_creation_events
    WHERE account_group_id=? AND created_at>datetime('now','-1 month')`).get(groupId) as { count: number }).count
}

export function markGroupEmailVerified(database: Database, userId: number) {
  if (!accountGroupsAvailable(database)) {
    database.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP) WHERE id=?')
      .run(userId)
    return
  }
  const group = ensureAccountGroup(database, userId)
  if (!group) return
  database.query(`UPDATE users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP)
    WHERE account_group_id=?`).run(group.id)
}

export function detachAccountFromGroup(database: Database, userId: number) {
  const group = groupForUser(database, userId)
  if (!group) return
  const replacement = database.query(`SELECT id FROM users WHERE account_group_id=? AND id!=? AND deleted_at IS NULL
    ORDER BY created_at,id LIMIT 1`).get(group.id, userId) as { id: number } | null
  database.query('UPDATE users SET account_group_id=NULL WHERE id=?').run(userId)
  if (!replacement) {
    database.query('DELETE FROM account_groups WHERE id=?').run(group.id)
    return
  }
  database.query(`UPDATE account_groups SET
      primary_user_id=CASE WHEN primary_user_id=? THEN ? ELSE primary_user_id END,
      selected_user_id=CASE WHEN selected_user_id=? THEN ? ELSE selected_user_id END
    WHERE id=?`).run(userId, replacement.id, userId, replacement.id, group.id)
}
