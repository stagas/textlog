import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { emailChangeForToken, issueEmailChangeAuthorization } from './email-change-authorization'

function database() {
  const db = new Database(':memory:', { strict: true })
  db.run(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,password TEXT,deleted_at TEXT);
    CREATE TABLE email_change_authorizations(token_hash TEXT PRIMARY KEY,user_id INTEGER,current_email TEXT,
      new_email TEXT,expires_at INTEGER);
    INSERT INTO users VALUES(1,'old@example.com','!',NULL);`)
  return db
}

test('email change approval is bound to the current email and a passwordless account', () => {
  const db = database()
  const value = issueEmailChangeAuthorization(db, 1, 'old@example.com', 'new@example.com', 1000)
  expect(emailChangeForToken(db, value, 1001)).toEqual({ user_id: 1, new_email: 'new@example.com' })
  db.query('UPDATE users SET email=? WHERE id=1').run('other@example.com')
  expect(emailChangeForToken(db, value, 1001)).toBeNull()
})

test('a newer email change approval replaces the previous request', () => {
  const db = database()
  const first = issueEmailChangeAuthorization(db, 1, 'old@example.com', 'first@example.com', 1000)
  const second = issueEmailChangeAuthorization(db, 1, 'old@example.com', 'second@example.com', 1100)
  expect(emailChangeForToken(db, first, 1101)).toBeNull()
  expect(emailChangeForToken(db, second, 1101)?.new_email).toBe('second@example.com')
})
