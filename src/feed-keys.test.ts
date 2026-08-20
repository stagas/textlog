import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { feedKeyHash, issueFeedKey, userForFeedKey } from './feed-keys'

test('feed keys are random, hashed, retained, expiring, and independently revocable', () => {
  const database = new Database(':memory:')
  database.run(`CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT,email TEXT,bio TEXT,deleted_at TEXT,
      suspended_at TEXT,email_verified_at TEXT,handle_chosen_at TEXT,timezone TEXT,
      show_link_previews INTEGER);
    CREATE TABLE feed_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,token_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,last_used_at INTEGER);
    INSERT INTO users(id,handle,email,bio) VALUES(1,'alice','alice@example.com','');`)

  const first = issueFeedKey(database, 1, 'first', null, 100)
  expect(first.value).toMatch(/^[a-f0-9]{64}$/)
  expect(database.query('SELECT token_hash FROM feed_keys WHERE id=?').get(first.id))
    .toEqual({ token_hash: feedKeyHash(first.value) })
  expect(userForFeedKey(database, first.value, 150)?.id).toBe(1)

  const second = issueFeedKey(database, 1, 'second', 300, 200)
  expect(second.value).not.toBe(first.value)
  expect(userForFeedKey(database, first.value, 250)?.id).toBe(1)
  expect(userForFeedKey(database, second.value, 250)?.handle).toBe('alice')
  expect(userForFeedKey(database, second.value, 301)).toBeNull()
  const legacy = `tlf_${'A'.repeat(43)}`
  database.query(`INSERT INTO feed_keys(token_hash,user_id,name,created_at)
    VALUES(?,?,?,?)`).run(feedKeyHash(legacy), 1, 'legacy', 50)
  expect(userForFeedKey(database, legacy, 250)?.id).toBe(1)
  database.query('DELETE FROM feed_keys WHERE id=?').run(first.id)
  expect(userForFeedKey(database, first.value, 250)).toBeNull()
})
