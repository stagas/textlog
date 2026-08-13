import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountChoices, accountForEmail, createAccountGroup, detachAccountFromGroup, isPrimaryAccount, selectAccount }
  from './account-groups'
import { runMigrations } from './migrations'

function fixture() {
  const database = new Database(':memory:')
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
