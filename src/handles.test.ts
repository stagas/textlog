import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createAccount, resolveHandle, updateProfileHandle } from './handles'

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
})
