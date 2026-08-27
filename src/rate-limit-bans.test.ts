import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { clearRateLimitBans } from './rate-limit-bans'

test('clears persistent rate-limit bans without removing IP request history', () => {
  const database = new Database(':memory:', { strict: true })
  database.run(`CREATE TABLE auth_rate_limits (id INTEGER PRIMARY KEY,scope TEXT,key_hash TEXT,created_at INTEGER);
    CREATE TABLE api_rate_limit_buckets (scope TEXT,key_hash TEXT,bucket_start INTEGER,count INTEGER);
    CREATE TABLE daily_ip_requests (
      day TEXT,ip_hash TEXT,request_count INTEGER,blocked_at TEXT,blocked_by INTEGER
    );
    INSERT INTO auth_rate_limits VALUES(1,'login','auth',1),(2,'signup','signup',2);
    INSERT INTO api_rate_limit_buckets VALUES('api','api',1,100);
    INSERT INTO daily_ip_requests VALUES
      ('2026-08-27','blocked',10,'2026-08-27 12:00:00',1),
      ('2026-08-27','allowed',20,NULL,NULL),
      ('2026-08-26','historical',30,'2026-08-26 12:00:00',1);`)

  // Keep the test independent of the wall clock while exercising SQLite's date('now') predicate.
  database.query(`UPDATE daily_ip_requests SET day=date('now') WHERE ip_hash IN ('blocked','allowed')`).run()

  expect(clearRateLimitBans(database)).toEqual({ authAttempts: 2, apiBuckets: 1, blockedIps: 1 })
  expect(database.query('SELECT count(*) count FROM auth_rate_limits').get()).toEqual({ count: 0 })
  expect(database.query('SELECT count(*) count FROM api_rate_limit_buckets').get()).toEqual({ count: 0 })
  expect(database.query(`SELECT ip_hash,request_count,blocked_at,blocked_by
    FROM daily_ip_requests ORDER BY ip_hash`).all()).toEqual([
    { ip_hash: 'allowed', request_count: 20, blocked_at: null, blocked_by: null },
    { ip_hash: 'blocked', request_count: 10, blocked_at: null, blocked_by: null },
    { ip_hash: 'historical', request_count: 30, blocked_at: '2026-08-26 12:00:00', blocked_by: 1 },
  ])
  database.close()
})
