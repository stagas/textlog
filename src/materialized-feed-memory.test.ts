import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { configureDatabaseService } from './database-service'
import { invalidateMaterializedFeedMemory, rpcMaterializedFeedPage } from './materialized-feed-service'
import { runMigrations } from './migrations'

const previousMemorySetting = Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE
const database = new Database(':memory:', { strict: true })

beforeAll(() => {
  Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE = 'true'
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES(1,'alice','alice@example.test','x');
    INSERT INTO posts(id,user_id,body) VALUES(1,1,'first');`)
  configureDatabaseService({ call: (operation, input) => executeDatabaseDomain(database, operation, input) })
  invalidateMaterializedFeedMemory()
})

afterAll(() => {
  invalidateMaterializedFeedMemory()
  if (previousMemorySetting === undefined) delete Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE
  else Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE = previousMemorySetting
  database.close()
})

test('memory feed is invalidated when another process advances its generation', async () => {
  const request = new Request('http://localhost/new')
  let renders = 0
  const render = () => new Response(`<main>${++renders}</main>`, {
    headers: { 'content-type': 'text/html;charset=utf-8' },
  })
  const cacheVersion = 2_000_000_000 + Math.floor(Math.random() * 100_000_000)

  const first = await rpcMaterializedFeedPage(request, 'new', -1, render, false, cacheVersion)
  expect(await first.text()).toBe('<main>1</main>')
  const memory = await rpcMaterializedFeedPage(request, 'new', -1, render, false, cacheVersion)
  expect(memory.headers.get('x-feed-cache')).toBe('memory')

  // Bypass the configured service to model a post committed by a different application process.
  database.run("INSERT INTO posts(id,user_id,body) VALUES(2,1,'second')")

  const refreshed = await rpcMaterializedFeedPage(request, 'new', -1, render, false, cacheVersion)
  expect(refreshed.headers.get('x-feed-cache')).not.toBe('memory')
  // Let the deliberately stale durable artifact finish its scheduled refresh before closing this fixture.
  await Bun.sleep(100)
})
