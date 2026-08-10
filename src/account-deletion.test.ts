import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountForDeletionToken, issueAccountDeletionToken } from './account-deletion'

function testDatabase() {
  const database = new Database(':memory:', { strict: true })
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,email TEXT NOT NULL,password TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE account_deletion_tokens (
      token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),email TEXT NOT NULL,
      expires_at INTEGER NOT NULL);
    INSERT INTO users VALUES(1,'reader@example.com','!',NULL);`)
  return database
}

test('account deletion tokens are single-account, expiring confirmations', () => {
  const database = testDatabase()
  const first = issueAccountDeletionToken(database, 1, 'reader@example.com', 1000)
  expect(accountForDeletionToken(database, first, 1001)).toEqual({ id: 1, email: 'reader@example.com' })

  const replacement = issueAccountDeletionToken(database, 1, 'reader@example.com', 1100)
  expect(accountForDeletionToken(database, first, 1101)).toBeNull()
  expect(accountForDeletionToken(database, replacement, 1101)?.id).toBe(1)
  expect(accountForDeletionToken(database, replacement, 3601101)).toBeNull()
})

test('enabling a password invalidates an outstanding email deletion token', () => {
  const database = testDatabase()
  const value = issueAccountDeletionToken(database, 1, 'reader@example.com', 1000)
  database.query('UPDATE users SET password=? WHERE id=1').run('password-hash')
  expect(accountForDeletionToken(database, value, 1001)).toBeNull()
})

test('changing the account email invalidates an outstanding deletion token', () => {
  const database = testDatabase()
  const value = issueAccountDeletionToken(database, 1, 'reader@example.com', 1000)
  database.query('UPDATE users SET email=? WHERE id=1').run('new@example.com')
  expect(accountForDeletionToken(database, value, 1001)).toBeNull()
})
