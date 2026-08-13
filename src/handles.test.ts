import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createAccountGroup } from './account-groups'
import { anonymizeUser } from './admin'
import { createAccount, resolveHandle, updateProfileHandle } from './handles'
import { claimInitialHandle } from './handles'
import { runMigrations } from './migrations'

function fixture() {
  const database = new Database(':memory:')
  database.run(`PRAGMA foreign_keys=ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,handle TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,
      bio TEXT DEFAULT '',password TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(handle,email,password) VALUES('alpha','alpha@example.com','x'),('other','other@example.com','x');`)
  return database
}

describe('handle history', () => {
  test('reserves previous handles and resolves them to the current profile', () => {
    const database = fixture()
    updateProfileHandle(database, 1, 'beta', 'new bio')

    expect(resolveHandle(database, 'alpha')).toEqual({ id: 1, handle: 'beta', alias: true })
    expect(resolveHandle(database, 'beta')).toEqual({ id: 1, handle: 'beta', alias: false })
    expect(database.query('SELECT bio FROM users WHERE id=1').get()).toEqual({ bio: 'new bio' })
    expect(() => createAccount(database, 'alpha', 'new@example.com', 'x')).toThrow()
    expect(() => updateProfileHandle(database, 2, 'alpha', '')).toThrow()
  })

  test('allows the original owner to reclaim a previous handle and reserves the newer one', () => {
    const database = fixture()
    updateProfileHandle(database, 1, 'beta', '')
    updateProfileHandle(database, 1, 'alpha', '')

    expect(resolveHandle(database, 'alpha')).toEqual({ id: 1, handle: 'alpha', alias: false })
    expect(resolveHandle(database, 'beta')).toEqual({ id: 1, handle: 'alpha', alias: true })
    expect(() => createAccount(database, 'beta', 'new@example.com', 'x')).toThrow()
  })

  test('does not create history when only the bio changes', () => {
    const database = fixture()
    updateProfileHandle(database, 1, 'alpha', 'bio only')

    expect(database.query('SELECT * FROM handle_history').all()).toHaveLength(0)
  })

  test('lets the same account group reclaim a deleted persona handle', () => {
    const database = new Database(':memory:')
    database.run('PRAGMA foreign_keys=ON')
    runMigrations(database)
    const primary = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
      VALUES('primary','shared@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
    const group = createAccountGroup(database, primary.id, 'shared@example.com')
    const persona = database.query(`INSERT INTO users(handle,email,password,account_group_id)
      VALUES('temporary','shared@example.com','!',?) RETURNING id`).get(group.id) as { id: number }
    claimInitialHandle(database, persona.id, 'reclaim_me')
    database.query('INSERT INTO account_creation_events(account_group_id,user_id) VALUES(?,?)')
      .run(group.id, persona.id)
    anonymizeUser(database, persona.id)
    expect(database.query('SELECT COUNT(*) count FROM account_creation_events WHERE account_group_id=?').get(group.id))
      .toEqual({ count: 0 })

    const outsider = database.query(`INSERT INTO users(handle,email,password,handle_chosen_at)
      VALUES('outsider','other@example.com','!',CURRENT_TIMESTAMP) RETURNING id`).get() as { id: number }
    createAccountGroup(database, outsider.id, 'other@example.com')
    expect(() => updateProfileHandle(database, outsider.id, 'reclaim_me', '')).toThrow()

    database.query('INSERT INTO account_creation_events(account_group_id,user_id) VALUES(?,?),(?,?)')
      .run(group.id, primary.id, group.id, primary.id)
    const replacement = database.query(`INSERT INTO users(handle,email,password,account_group_id)
      VALUES('replacement','shared@example.com','!',?) RETURNING id`).get(group.id) as { id: number }
    database.query('INSERT INTO account_creation_events(account_group_id,user_id) VALUES(?,?)')
      .run(group.id, replacement.id)
    let reclaimed = false
    claimInitialHandle(database, replacement.id, 'reclaim_me', value => {
      reclaimed = value
      if (!value) throw new Error('monthly limit')
    })
    expect(reclaimed).toBe(true)
    expect(database.query('SELECT handle FROM users WHERE id=?').get(replacement.id))
      .toEqual({ handle: 'reclaim_me' })
    expect(database.query('SELECT user_id,account_group_id FROM handle_history WHERE handle=?').get('reclaim_me'))
      .toEqual({ user_id: replacement.id, account_group_id: group.id })
    expect(database.query('SELECT COUNT(*) count FROM account_creation_events WHERE account_group_id=?').get(group.id))
      .toEqual({ count: 2 })
  })
})
