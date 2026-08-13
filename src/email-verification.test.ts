import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { confirmEmailToken, findEmailToken } from './email-verification'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function fixture() {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,email_verified_at TEXT);
    CREATE TABLE email_tokens (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,kind TEXT NOT NULL,
      email TEXT NOT NULL,expires_at INTEGER NOT NULL);
    INSERT INTO users(id,email) VALUES(1,'reader@example.com'),(2,'taken@example.com');`)
  return database
}

describe('email confirmation', () => {
  test('validates a GET token without consuming it or changing the account', () => {
    const database = fixture()
    database.query('INSERT INTO email_tokens VALUES(?,?,?,?,?)')
      .run(hash('verify-token'), 1, 'verify', 'reader@example.com', 2000)

    const record = findEmailToken(database, 'verify-token', 1000)

    expect(record).toMatchObject({ user_id: 1, kind: 'verify', email: 'reader@example.com' })
    expect(database.query('SELECT email_verified_at FROM users WHERE id=1').get())
      .toEqual({ email_verified_at: null })
    expect(database.query('SELECT count(*) count FROM email_tokens').get()).toEqual({ count: 1 })
  })

  test('confirms verification only once on POST', () => {
    const database = fixture()
    database.query('INSERT INTO email_tokens VALUES(?,?,?,?,?)')
      .run(hash('verify-token'), 1, 'verify', 'reader@example.com', 2000)

    expect(confirmEmailToken(database, 'verify-token', 1000)).toEqual({ ok: true, kind: 'verify' })
    expect(database.query('SELECT email_verified_at IS NOT NULL verified FROM users WHERE id=1').get())
      .toEqual({ verified: 1 })
    expect(confirmEmailToken(database, 'verify-token', 1000)).toEqual({ ok: false, reason: 'invalid' })
  })

  test('changes an email atomically and preserves the token when the address becomes unavailable', () => {
    const database = fixture()
    database.query('INSERT INTO email_tokens VALUES(?,?,?,?,?)')
      .run(hash('change-token'), 1, 'change', 'taken@example.com', 2000)

    expect(confirmEmailToken(database, 'change-token', 1000))
      .toEqual({ ok: false, reason: 'email_unavailable' })
    expect(database.query('SELECT email FROM users WHERE id=1').get()).toEqual({ email: 'reader@example.com' })
    expect(database.query('SELECT count(*) count FROM email_tokens').get()).toEqual({ count: 1 })

    database.query('UPDATE email_tokens SET email=\'new@example.com\'').run()
    expect(confirmEmailToken(database, 'change-token', 1000)).toEqual({ ok: true, kind: 'change' })
    expect(database.query('SELECT email,email_verified_at IS NOT NULL verified FROM users WHERE id=1').get())
      .toEqual({ email: 'new@example.com', verified: 1 })
    expect(database.query('SELECT count(*) count FROM email_tokens').get()).toEqual({ count: 0 })
  })

  test('changes the shared email for every account in a group', () => {
    const database = new Database(':memory:')
    database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,email TEXT NOT NULL,email_verified_at TEXT,
        deleted_at TEXT,account_group_id INTEGER);
      CREATE TABLE account_groups (id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,
        primary_user_id INTEGER NOT NULL,selected_user_id INTEGER NOT NULL);
      CREATE TABLE email_tokens (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,kind TEXT NOT NULL,
        email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      INSERT INTO users VALUES
        (1,'shared@example.com',NULL,NULL,10),(2,'shared@example.com',NULL,NULL,10);
      INSERT INTO account_groups VALUES(10,'shared@example.com',1,2);`)
    database.query('INSERT INTO email_tokens VALUES(?,?,?,?,?)')
      .run(hash('group-change'), 2, 'change', 'new-shared@example.com', 2000)

    expect(confirmEmailToken(database, 'group-change', 1000)).toEqual({ ok: true, kind: 'change' })
    expect(database.query('SELECT email,email_verified_at IS NOT NULL verified FROM users ORDER BY id').all())
      .toEqual([
        { email: 'new-shared@example.com', verified: 1 },
        { email: 'new-shared@example.com', verified: 1 },
      ])
    expect(database.query('SELECT email FROM account_groups WHERE id=10').get())
      .toEqual({ email: 'new-shared@example.com' })
  })
})
