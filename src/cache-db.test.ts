import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCacheDatabase, createCacheDatabase } from './cache-db'

test('cache database waits for concurrent writers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'textlog-cache-'))
  const database = createCacheDatabase(join(directory, 'cache.sqlite'))
  try {
    const configured = Number(Bun.env.DATABASE_BUSY_TIMEOUT_MS || 5000)
    expect(database.query('PRAGMA busy_timeout').get()).toEqual({ timeout: configured })
  }
  finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('clears every durable cache', () => {
  const database = createCacheDatabase(':memory:')
  try {
    const snapshot = database.query(`INSERT INTO feed_snapshots(kind,viewer_id,generation,total_items)
      VALUES('latest',-1,1,1)`).run()
    database.query('INSERT INTO feed_snapshot_items(snapshot_id,position,payload) VALUES(?,?,?)')
      .run(snapshot.lastInsertRowid, 0, '{}')
    database.query(`INSERT INTO materialized_feed_pages_v2(kind,viewer_id,variant,generation,html)
      VALUES('latest',-1,'test',1,'cached')`).run()
    database.query(`INSERT INTO recent_feed_visitors(user_id,request_url,cookie,page_size,density,last_visited_at)
      VALUES(1,'/latest','session=test',20,'regular',1)`).run()

    clearCacheDatabase(database)

    for (const table of ['feed_snapshots', 'feed_snapshot_items', 'materialized_feed_pages_v2',
      'recent_feed_visitors']) {
      expect(database.query(`SELECT count(*) count FROM ${table}`).get()).toEqual({ count: 0 })
    }
  }
  finally {
    database.close()
  }
})
