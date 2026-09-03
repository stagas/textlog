import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { cacheDb } from './cache-db'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'

test('latest serves the prior artifact after additions but not after strict mutations', async () => {
  const database = new Database(':memory:', { strict: true })
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'alice','alice@example.test','x');
    INSERT INTO posts(id,user_id,body) VALUES(1,1,'first');`)
  const variant = `safe-publication-${crypto.randomUUID()}`

  try {
    const initial = await executeDatabaseDomain(database, 'cache.materializedFeedGet', {
      kind: 'latest',
      viewerId: -1,
      variant,
    })
    expect(initial).toMatchObject({ html: null, stale: false })
    await executeDatabaseDomain(database, 'cache.materializedFeedPut', {
      kind: 'latest',
      viewerId: -1,
      variant,
      generation: initial.generation,
      html: '<main>first</main>',
    })

    database.run('INSERT INTO posts(id,user_id,body) VALUES(2,1,\'second\')')
    const additive = await executeDatabaseDomain(database, 'cache.materializedFeedGet', {
      kind: 'latest',
      viewerId: -1,
      variant,
    })
    expect(additive.html).toBe('<main>first</main>')
    expect(additive.stale).toBeTrue()
    expect(additive.generation).toBeGreaterThan(initial.generation)

    database.run('UPDATE posts SET body=\'edited\' WHERE id=1')
    expect(await executeDatabaseDomain(database, 'cache.materializedFeedGet', {
      kind: 'latest',
      viewerId: -1,
      variant,
    })).toMatchObject({ html: null, stale: false })
  }
  finally {
    cacheDb.query('DELETE FROM materialized_feed_pages_v2 WHERE variant=?').run(variant)
    database.close()
  }
})
