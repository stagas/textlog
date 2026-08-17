import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { accountForRecapToken, issueRecapUnsubscribeToken } from './recap-emails'

test('recap unsubscribe tokens are opaque, durable, and bound to one account', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT,recap_emails INTEGER,deleted_at TEXT
  );
  CREATE TABLE recap_unsubscribe_tokens (
    token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO users VALUES(1,'reader','reader@example.com','',1,NULL);`)

  const first = issueRecapUnsubscribeToken(database, 1)
  const second = issueRecapUnsubscribeToken(database, 1)

  expect(first).not.toBe(second)
  expect(accountForRecapToken(database, first)).toMatchObject({ id: 1 })
  expect(accountForRecapToken(database, second)).toMatchObject({ id: 1, handle: 'reader', recap_emails: 1 })
  expect(database.query('SELECT token_hash FROM recap_unsubscribe_tokens').get())
    .not.toEqual({ token_hash: second })
})
