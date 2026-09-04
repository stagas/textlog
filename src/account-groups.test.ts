import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountChoices, accountForEmail, createAccountGroup, detachAccountFromGroup, isPrimaryAccount,
  selectAccount } from './account-groups'
import { executeDatabaseDomain } from './database-domain'
import { hasUnreadForYou } from './for-you-state'
import { runMigrations } from './migrations'
import { insertSession, sessionHash } from './sessions'

function fixture() {
  const database = new Database(':memory:', { strict: true })
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  const primary = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
    VALUES('primary','shared@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
  const group = createAccountGroup(database, primary.id, 'shared@example.com')
  const persona = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at,account_group_id)
    VALUES('persona','shared@example.com','!',CURRENT_TIMESTAMP,?) RETURNING id`).get(group.id) as { id: number }
  return { database, primary, persona, group }
}

test('email login resolves the selected full account while preserving the primary', () => {
  const { database, primary, persona } = fixture()

  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(primary.id)
  expect(selectAccount(database, persona.id)).toBe(true)
  expect(isPrimaryAccount(database, primary.id)).toBe(true)
  expect(isPrimaryAccount(database, persona.id)).toBe(false)
  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(persona.id)
  expect(accountChoices(database, persona.id)).toEqual([
    expect.objectContaining({ id: primary.id, primary: true, selected: false }),
    expect.objectContaining({ id: persona.id, primary: false, selected: true }),
  ])
})

test('removing the selected primary promotes a remaining account', () => {
  const { database, primary, persona, group } = fixture()
  detachAccountFromGroup(database, primary.id)

  expect(database.query('SELECT primary_user_id,selected_user_id FROM account_groups WHERE id=?').get(group.id))
    .toEqual({ primary_user_id: persona.id, selected_user_id: persona.id })
  expect(accountForEmail(database, 'shared@example.com')?.id).toBe(persona.id)
})

test('linked-account unread activity appears live and clears when that account is selected', async () => {
  const { database, primary, persona } = fixture()
  const actor = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
    VALUES('actor','actor@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
  const root = database.query(`INSERT INTO posts(user_id,body,created_at)
    VALUES(?,'persona root',CURRENT_TIMESTAMP) RETURNING id`).get(persona.id) as { id: number }
  database.query(`INSERT INTO posts(user_id,parent_id,body,created_at)
    VALUES(?,?,'new reply',CURRENT_TIMESTAMP)`).run(actor.id, root.id)
  const token = 'linked-account-unread-session'
  const now = Date.now()
  insertSession(database, token, primary.id, now + 60_000, now, 'test')

  const before = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token, bearerToken: null, deviceId: null, now,
  })
  expect(before.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])

  await executeDatabaseDomain(database, 'account.select', {
    userId: primary.id, targetId: persona.id, sessionHash: sessionHash(token),
  })
  expect(hasUnreadForYou(persona.id, database)).toBe(false)
  await executeDatabaseDomain(database, 'account.select', {
    userId: persona.id, targetId: primary.id, sessionHash: sessionHash(token),
  })

  const after = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token, bearerToken: null, deviceId: null, now,
  })
  expect(after.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: false }),
  ])

  database.query(`INSERT INTO posts(user_id,parent_id,body,created_at)
    VALUES(?,?,'newer reply',datetime('now','+1 second'))`).run(actor.id, root.id)
  const afterNewActivity = await executeDatabaseDomain(database, 'auth.resolve', {
    sessionToken: token, bearerToken: null, deviceId: null, now,
  })
  expect(afterNewActivity.sessionUser?.linked_accounts).toEqual([
    expect.objectContaining({ id: persona.id, has_unread: true }),
  ])
})
