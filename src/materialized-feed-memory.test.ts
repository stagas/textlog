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
  const render = () =>
    new Response(`<main>${++renders}</main>`, {
      headers: { 'content-type': 'text/html;charset=utf-8' },
    })
  const cacheVersion = 2_000_000_000 + Math.floor(Math.random() * 100_000_000)

  const first = await rpcMaterializedFeedPage(request, 'latest', -1, render, false, cacheVersion)
  expect(await first.text()).toBe('<main>1</main>')
  const memory = await rpcMaterializedFeedPage(request, 'latest', -1, render, false, cacheVersion)
  expect(memory.headers.get('x-feed-cache')).toBe('memory')

  // Bypass the configured service to model a post committed by a different application process.
  database.run('INSERT INTO posts(id,user_id,body) VALUES(2,1,\'second\')')

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

test('a warmed all feed marks visible posts read when that account opens it', async () => {
  const request = new Request('http://localhost/all')
  const alice: User = { id: 1, handle: 'alice', email: 'alice@example.test', bio: '' }
  const post = createPost(database, 3, 'unread before switching to alice', null, false)
  if (!('id' in post)) throw new Error('could not create unread post')
  const cacheVersion = 2_140_000_000 + Math.floor(Math.random() * 7_000_000)
  const load = (markRead: boolean) =>
    executeDatabaseDomain(database, 'feeds.latestPage', {
      viewerId: alice.id,
      page: 1,
      pageSize: 20,
      markRead,
    })
  const body = (feed: Awaited<ReturnType<typeof load>>, read = false) =>
    new Response(JSON.stringify({
      postIds: feed.posts.map(row => row.id),
      unreadPostIds: read ? [] : feed.unreadPostIds,
      unreadMarkup: read || !feed.unreadPostIds?.length
        ? ''
        : '<span class="unread-dot" aria-label="unread"></span>',
    }))

  await rpcMaterializedFeedPage(request, 'latest', alice.id, async () => body(await load(false)), false, cacheVersion)
  const warmed = await rpcMaterializedFeedPage(request, 'latest', alice.id, async () => body(await load(false)), false,
    cacheVersion)
  expect(warmed.headers.get('x-feed-cache')).toBe('memory')
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: alice.id })).toBeGreaterThan(0)

  let loaded: Awaited<ReturnType<typeof load>> | undefined
  const data = async () => loaded ||= await load(true)
  const opened = await rpcMaterializedFeedPage(request, 'latest', alice.id, async () => body(await data()), false,
    cacheVersion, false, async () => body(await data(), true),
    async () => ((await data()).unreadPostIds?.length || 0) > 0)

  expect(opened.headers.get('x-feed-cache')).toBe('memory')
  expect(await opened.json()).toMatchObject({ unreadPostIds: expect.arrayContaining([post.id]) })
  expect(await executeDatabaseDomain(database, 'feeds.latestUnreadCount', { userId: alice.id })).toBe(0)

  invalidateMaterializedFeedMemory()
  loaded = undefined
  const revisited = await rpcMaterializedFeedPage(request, 'latest', alice.id, async () => body(await data()), false,
    cacheVersion, false, async () => body(await data(), true),
    async () => ((await data()).unreadPostIds?.length || 0) > 0)
  expect(await revisited.json()).toMatchObject({ unreadPostIds: [], unreadMarkup: '' })
})

test('my feed shows unread counters and dots once before caching its read state', async () => {
  const request = new Request('http://localhost/my-feed')
  const cacheVersion = 2_147_000_000 + Math.floor(Math.random() * 400_000)
  const alice: User = { id: 1, handle: 'alice', email: 'alice@example.test', bio: '' }
  const load = () =>
    executeDatabaseDomain(database, 'feeds.personalizedPage', {
      user: alice,
      page: 1,
      pageSize: 20,
      toMe: false,
      path: '/my-feed',
      markRead: false,
    })
  const body = (feed: Awaited<ReturnType<typeof load>>) =>
    new Response(
      `<a href="/my-feed">my feed${
        feed.forYouCount
          ? `<span class="to-me-count">${feed.forYouCount}</span>`
          : ''
      }</a><a href="/all">all${
        feed.latestCount
          ? `<span class="to-me-count">${feed.latestCount}</span>`
          : ''
      }</a>${
        feed.timeline.filter(row => row.unread)
          .map(() => '<span class="unread-dot" aria-label="unread"></span>').join('')
      }`,
    )

  await rpcMaterializedFeedPage(request, 'for-you', alice.id, async () => body(await load()), false, cacheVersion)
  invalidateMaterializedFeedMemory()
  const open = () =>
    rpcMaterializedFeedPage(request, 'for-you', alice.id, async () => body(await load()), false, cacheVersion, false,
      async () => body(await load()), async () =>
      await executeDatabaseDomain(database, 'feeds.markPersonalizedSnapshotPageRead', {
        userId: alice.id,
        pageSize: 20,
        toMe: false,
      }) > 0)

  const firstVisit = await open()
  const firstHtml = await firstVisit.text()
  expect(firstVisit.headers.get('x-feed-cache')).toBe('durable')
  expect(firstHtml).toContain('to-me-count')
  expect(firstHtml).toContain('aria-label="unread"')

  const secondVisit = await open()
  const secondHtml = await secondVisit.text()
  expect(secondHtml).not.toContain('to-me-count')
  expect(secondHtml).toContain('<a href="/all">all</a>')
  expect(secondHtml).not.toContain('aria-label="unread"')
})

test('@ shows a cached directed entry unread once and consumes it on the next visit', async () => {
  const request = new Request('http://localhost/@')
  const cacheVersion = 2_147_400_000 + Math.floor(Math.random() * 400_000)
  const alice: User = { id: 1, handle: 'alice', email: 'alice@example.test', bio: '' }
  const root = createPost(database, alice.id, 'cached @ read target', null, false)
  if (!('id' in root)) throw new Error('could not create @ read target')
  const reply = createPost(database, 2, 'cached directed activity', root.id, false)
  if (!('id' in reply)) throw new Error('could not create directed activity')
  const load = () =>
    executeDatabaseDomain(database, 'feeds.personalizedPage', {
      user: alice,
      page: 1,
      pageSize: 20,
      toMe: true,
      path: '/@',
      markRead: false,
    })
  const body = (feed: Awaited<ReturnType<typeof load>>) =>
    new Response(
      `<a href="/@">@${
        feed.toMeCount
          ? `<span class="to-me-count">${feed.toMeCount}</span>`
          : ''
      }</a>${
        feed.timeline.filter(row => row.unread)
          .map(() => '<span class="unread-dot" aria-label="unread"></span>').join('')
      }`,
    )

  await rpcMaterializedFeedPage(request, 'to-me', alice.id, async () => body(await load()), false, cacheVersion)
  const open = () =>
    rpcMaterializedFeedPage(request, 'to-me', alice.id, async () => body(await load()), false, cacheVersion, false,
      async () => body(await load()), async () =>
      await executeDatabaseDomain(database, 'feeds.markPersonalizedSnapshotPageRead', {
        userId: alice.id,
        pageSize: 20,
        toMe: true,
      }) > 0)

  const firstVisit = await open()
  const firstHtml = await firstVisit.text()
  expect(firstVisit.headers.get('x-feed-cache')).toBe('memory')
  expect(firstHtml).toContain('to-me-count')
  expect(firstHtml).toContain('aria-label="unread"')

  const secondVisit = await open()
  const secondHtml = await secondVisit.text()
  expect(secondHtml).not.toContain('to-me-count')
  expect(secondHtml).not.toContain('aria-label="unread"')
})
