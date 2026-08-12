import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { CLEANUP_BATCH_SIZE, runBoundedCleanup } from './maintenance'

function database() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE sessions(expires_at INTEGER);
    CREATE TABLE password_resets(expires_at INTEGER);
    CREATE TABLE email_tokens(expires_at INTEGER);
    CREATE TABLE account_deletion_tokens(expires_at INTEGER);
    CREATE TABLE password_enable_tokens(expires_at INTEGER);
    CREATE TABLE email_change_authorizations(expires_at INTEGER);
    CREATE TABLE magic_links(expires_at INTEGER);
    CREATE TABLE password_login_nonces(expires_at INTEGER);
    CREATE TABLE auth_rate_limits(created_at INTEGER);
    CREATE TABLE api_rate_limit_buckets(bucket_start INTEGER);
    CREATE TABLE daily_visitors(day TEXT,visitor_hash TEXT);`)
  return db
}

describe('periodic database maintenance', () => {
  test('removes expired operational rows while preserving current data', () => {
    const db = database()
    const now = Date.parse('2026-08-08T12:00:00Z')
    db.run(`INSERT INTO sessions VALUES(1),(?);
      INSERT INTO password_resets VALUES(1);
      INSERT INTO email_tokens VALUES(1);
      INSERT INTO account_deletion_tokens VALUES(1);
      INSERT INTO password_enable_tokens VALUES(1);
      INSERT INTO email_change_authorizations VALUES(1);
      INSERT INTO magic_links VALUES(1);
      INSERT INTO password_login_nonces VALUES(1);
      INSERT INTO auth_rate_limits VALUES(1);
      INSERT INTO api_rate_limit_buckets VALUES(1);
      INSERT INTO daily_visitors VALUES('2026-08-01','old'),('2026-08-08','current');`, [now + 1])

    const removed = runBoundedCleanup(db, now)

    expect(removed).toEqual({ sessions: 1, passwordResets: 1, emailTokens: 1, accountDeletionTokens: 1,
      passwordEnableTokens: 1, emailChangeAuthorizations: 1, magicLinks: 1, passwordLoginNonces: 1, authRateLimits: 1,
      apiRateLimits: 1, visitors: 1 })
    expect(db.query('SELECT expires_at FROM sessions').all()).toEqual([{ expires_at: now + 1 }])
    expect(db.query('SELECT day FROM daily_visitors').all()).toEqual([{ day: '2026-08-08' }])
  })

  test('bounds each table cleanup pass', () => {
    const db = database()
    const insert = db.query('INSERT INTO auth_rate_limits VALUES(1)')
    for (let index = 0; index < CLEANUP_BATCH_SIZE + 10; index++) insert.run()
    expect(runBoundedCleanup(db, Date.now()).authRateLimits).toBe(CLEANUP_BATCH_SIZE)
    expect(db.query('SELECT count(*) count FROM auth_rate_limits').get()).toEqual({ count: 10 })
  })
})
