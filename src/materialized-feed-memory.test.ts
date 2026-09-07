import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { executeDatabaseDomain } from './database-domain'
import { configureDatabaseService } from './database-service'
import { invalidateMaterializedFeedMemory, rpcMaterializedFeedPage } from './materialized-feed-service'
import { runMigrations } from './migrations'
import { createPost } from './posts'
import type { User } from './types'

const previousMemorySetting = Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE
const database = new Database(':memory:', { strict: true })

beforeAll(() => {
  Bun.env.ENABLE_MATERIALIZED_MEMORY_CACHE = 'true'
  database.run('PRAGMA foreign_keys=ON')
  runMigrations(database)
  database.run(`INSERT INTO users(id,handle,email,password) VALUES
      (1,'alice','alice@example.test','x'),(2,'bob','bob@example.test','x'),
      (3,'charlie','charlie@example.test','x');
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

test('all feed memory is invalidated when another process advances its generation', async () => {
  const request = new Request('http://localhost/all')
  let renders = 0
  const render = () => new Response(`<main>${++renders}</main>`, {
    headers: { 'content-type': 'text/html;charset=utf-8' },
  })
  const cacheVersion = 2_000_000_000 + Math.floor(Math.random() * 100_000_000)

  const first = await rpcMaterializedFeedPage(request, 'latest', -1, render, false, cacheVersion)
  expect(await first.text()).toBe('<main>1</main>')
  const memory = await rpcMaterializedFeedPage(request, 'latest', -1, render, false, cacheVersion)
  expect(memory.headers.get('x-feed-cache')).toBe('memory')

  // Bypass the configured service to model a post committed by a different application process.
  database.run("INSERT INTO posts(id,user_id,body) VALUES(2,1,'second')")

  const refreshed = await rpcMaterializedFeedPage(request, 'latest', -1, render, false, cacheVersion)
  expect(refreshed.headers.get('x-feed-cache')).toBe('miss')
  expect(await refreshed.text()).toBe('<main>2</main>')
})

test('@ feed memory and snapshot are invalidated when directed replies and mentions arrive', async () => {
  const request = new Request('http://localhost/@')
  const alice: User = { id: 1, handle: 'alice', email: 'alice@example.test', bio: '' }
  const root = createPost(database, alice.id, 'reply target', null, false)
  if (!('id' in root)) throw new Error('could not create reply target')
  const render = async () => {
    const feed = await executeDatabaseDomain(database, 'feeds.personalizedPage', {
      user: alice,
      page: 1,
      pageSize: 20,
      toMe: true,
      path: '/@',
      markRead: false,
    })
    return new Response(JSON.stringify(feed.timeline.map(row => row.id)))
  }
  const cacheVersion = 2_100_000_000 + Math.floor(Math.random() * 40_000_000)

  await rpcMaterializedFeedPage(request, 'to-me', alice.id, render, false, cacheVersion)
  const memory = await rpcMaterializedFeedPage(request, 'to-me', alice.id, render, false, cacheVersion)
  expect(memory.headers.get('x-feed-cache')).toBe('memory')

  const reply = createPost(database, 2, 'fresh directed reply', root.id, false)
  if (!('id' in reply)) throw new Error('could not create directed reply')

  const refreshed = await rpcMaterializedFeedPage(request, 'to-me', alice.id, render, false, cacheVersion)
  expect(refreshed.headers.get('x-feed-cache')).toBe('miss')
  expect(await refreshed.json()).toContain(reply.id)

  const warmed = await rpcMaterializedFeedPage(request, 'to-me', alice.id, render, false, cacheVersion)
  expect(warmed.headers.get('x-feed-cache')).toBe('memory')
  const mention = createPost(database, 3, 'fresh explicit mention for @alice', null, false)
  if (!('id' in mention)) throw new Error('could not create explicit mention')

  const mentioned = await rpcMaterializedFeedPage(request, 'to-me', alice.id, render, false, cacheVersion)
  expect(mentioned.headers.get('x-feed-cache')).toBe('miss')
  expect(await mentioned.json()).toContain(mention.id)
})
