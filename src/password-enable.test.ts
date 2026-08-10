import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountForPasswordEnableToken, issuePasswordEnableToken } from './password-enable'

function testDatabase() {
  const database = new Database(':memory:', { strict: true })
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,email TEXT NOT NULL,password TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE password_enable_tokens (
      token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),email TEXT NOT NULL,
      expires_at INTEGER NOT NULL);
    INSERT INTO users VALUES(1,'reader@example.com','!',NULL);`)
  return database
}

test('password setup links expire and a newer request replaces the old one', () => {
  const database = testDatabase()
  const first = issuePasswordEnableToken(database, 1, 'reader@example.com', 1000)
  const second = issuePasswordEnableToken(database, 1, 'reader@example.com', 1100)
  expect(accountForPasswordEnableToken(database, first, 1101)).toBeNull()
  expect(accountForPasswordEnableToken(database, second, 1101)?.id).toBe(1)
  expect(accountForPasswordEnableToken(database, second, 3601101)).toBeNull()
})

test('password setup links stop working after an email or password change', () => {
  const database = testDatabase()
  const emailToken = issuePasswordEnableToken(database, 1, 'reader@example.com', 1000)
  database.query('UPDATE users SET email=? WHERE id=1').run('new@example.com')
  expect(accountForPasswordEnableToken(database, emailToken, 1001)).toBeNull()

  database.query('UPDATE users SET email=? WHERE id=1').run('reader@example.com')
  const passwordToken = issuePasswordEnableToken(database, 1, 'reader@example.com', 1100)
  database.query('UPDATE users SET password=? WHERE id=1').run('password-hash')
  expect(accountForPasswordEnableToken(database, passwordToken, 1101)).toBeNull()
})
