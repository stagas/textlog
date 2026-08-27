import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCacheDatabase } from './cache-db'

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
