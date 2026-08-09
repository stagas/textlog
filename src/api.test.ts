import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { publishPost } from './api-broker'
import { rebuildHotPosts } from './hot'
import { registerApiRoutes } from './routes/api'

function fixture(now?: () => number) {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,email TEXT,bio TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,suspended_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
    CREATE TABLE follows (follower_id INTEGER NOT NULL,following_id INTEGER NOT NULL);
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL,blocked_id INTEGER NOT NULL);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE auth_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE api_rate_limit_buckets (scope TEXT NOT NULL,key_hash TEXT NOT NULL,bucket_start INTEGER NOT NULL,
      count INTEGER NOT NULL,PRIMARY KEY(scope,key_hash,bucket_start));
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
    INSERT INTO users(id,handle,email,bio,created_at) VALUES
      (1,'Alice','alice@example.com','builder','2026-08-01 10:00:00'),
      (2,'Bob','bob@example.com','reader','2026-08-02 10:00:00'),
      (3,'Gone','gone@example.com','hidden','2026-08-02 10:00:00');
    UPDATE users SET deleted_at='2026-08-03 00:00:00' WHERE id=3;
    INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (1,1,NULL,'hello #textlog @bob','2026-08-03 10:00:00'),
      (2,2,1,'a reply','2026-08-03 11:00:00'),
      (3,1,NULL,'a latest','2026-08-03 12:00:00'),
      (4,3,NULL,'private by deletion','2026-08-03 13:00:00'),
      (5,1,NULL,'deleted post','2026-08-03 14:00:00');
    UPDATE posts SET deleted_at='2026-08-03 15:00:00' WHERE id=5;
    INSERT INTO post_hashtags(post_id,tag) VALUES(1,'textlog');
    INSERT INTO follows(follower_id,following_id) VALUES(2,1);
    INSERT INTO handle_history(handle,user_id) VALUES('oldalice',1);
    INSERT INTO post_hot SELECT id,0,created_at,created_at FROM posts;
    CREATE VIRTUAL TABLE post_search USING fts5(body,content='posts',content_rowid='id',tokenize='unicode61');
    INSERT INTO post_search(post_search) VALUES('rebuild');
  `)
  rebuildHotPosts(database)
  const app = new Hono()
  registerApiRoutes(app, database, null, now)
  return { app, database }
}

function request(app: Hono, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-textlog-client-ip', headers.get('x-textlog-client-ip') || 'test-ip')
  return app.fetch(new Request(`https://textlog.cc${path}`, { ...init, headers }))
}

describe('public API', () => {
  test('returns serialized public posts without private account data', async () => {
    const { app } = fixture()
    const response = await request(app, '/api/v1/feeds/latest')
    const payload = await response.json() as any

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(payload.data.map((post: any) => post.id)).toEqual([3, 2, 1])
    expect(payload.data[2]).toMatchObject({
      body: 'hello #textlog @bob',
      created_at: '2026-08-03T10:00:00.000Z',
      reply_count: 1,
      tags: ['textlog'],
      mentions: ['bob'],
      url: 'https://textlog.cc/post/1',
      author: { handle: 'alice', url: 'https://textlog.cc/u/alice' },
    })
    expect(JSON.stringify(payload)).not.toContain('alice@example.com')
    expect(JSON.stringify(payload)).not.toContain('user_id')
  })

  test('uses stable cursor pagination and validates pagination input', async () => {
    const { app } = fixture()
    const first = await (await request(app, '/api/v1/feeds/latest?limit=2')).json() as any
    const second =
      await (await request(app,
        `/api/v1/feeds/latest?limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`)).json() as any

    expect(first.data.map((post: any) => post.id)).toEqual([3, 2])
    expect(second.data.map((post: any) => post.id)).toEqual([1])
    expect(second.pagination.next_cursor).toBeNull()
    expect((await request(app, '/api/v1/feeds/latest?limit=101')).status).toBe(400)
    expect((await request(app, '/api/v1/feeds/latest?cursor=broken')).status).toBe(400)
  })

  test('returns hot posts using the existing activity ranking with cursor pagination', async () => {
    const { app } = fixture()
    const firstResponse = await request(app, '/api/v1/feeds/hot?limit=2')
    const first = await firstResponse.json() as any
    expect(firstResponse.status).toBe(200)
    expect(first.data).toHaveLength(2)
    expect(first.data[0].id).toBe(1)
    expect(first.data[0].reply_count).toBe(1)
    expect(first.pagination.next_cursor).toBeTruthy()

    const second =
      await (await request(app, `/api/v1/feeds/hot?limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`))
        .json() as any
    expect(second.data).toHaveLength(1)
    expect(new Set([...first.data, ...second.data].map(post => post.id)).size).toBe(3)
    expect((await request(app, '/api/v1/feeds/hot?cursor=broken')).status).toBe(400)
  })

  test('searches public posts without authentication and paginates results', async () => {
    const { app } = fixture()
    const firstResponse = await request(app, '/api/v1/search?q=a&limit=1')
    const first = await firstResponse.json() as any
    expect(firstResponse.status).toBe(200)
    expect(first.data).toHaveLength(1)
    expect(first.pagination.next_cursor).toBeTruthy()
    const second = await (await request(app,
      `/api/v1/search?q=a&limit=1&cursor=${encodeURIComponent(first.pagination.next_cursor)}`)).json() as any
    expect(second.data).toHaveLength(1)
    expect(second.data[0].id).not.toBe(first.data[0].id)
    expect((await request(app, '/api/v1/search')).status).toBe(400)
    expect((await request(app, '/api/v1/search?q=!!!')).status).toBe(400)
    expect((await request(app, `/api/v1/search?q=${'x'.repeat(101)}`)).status).toBe(400)
  })

  test('serves single posts, replies, users, and tags with documented errors', async () => {
    const { app } = fixture()
    const post = await (await request(app, '/api/v1/posts/1')).json() as any
    const replies = await (await request(app, '/api/v1/posts/1/replies')).json() as any
    const user = await (await request(app, '/api/v1/users/ALICE')).json() as any
    const userPosts = await (await request(app, '/api/v1/users/alice/posts')).json() as any
    const tags = await (await request(app, '/api/v1/tags/textlog/posts')).json() as any

    expect(post.data.id).toBe(1)
    expect(replies.data.map((item: any) => item.id)).toEqual([2])
    expect(user.data).toMatchObject({ handle: 'alice', bio: 'builder', post_count: 2, follower_count: 1,
      following_count: 0 })
    expect(user.data.email).toBeUndefined()
    expect(userPosts.data.map((item: any) => item.id)).toEqual([3, 1])
    expect(tags.data.map((item: any) => item.id)).toEqual([1])
    expect((await request(app, '/api/v1/posts/nope')).status).toBe(400)
    expect((await request(app, '/api/v1/posts/5')).status).toBe(404)
    expect((await request(app, '/api/v1/users/gone')).status).toBe(404)
    const oldProfile = await request(app, '/api/v1/users/oldalice')
    const oldPosts = await request(app, '/api/v1/users/oldalice/posts?limit=5')
    expect(oldProfile.status).toBe(308)
    expect(oldProfile.headers.get('location')).toBe('/api/v1/users/Alice')
    expect(oldPosts.status).toBe(308)
    expect(oldPosts.headers.get('location')).toBe('/api/v1/users/Alice/posts?limit=5')
  })

  test('supports preflight, publishes OpenAPI, and rejects mutation methods', async () => {
    const { app } = fixture()
    const preflight = await request(app, '/api/v1/feeds/latest', { method: 'OPTIONS' })
    const rss = await request(app, '/api/v1/feeds/latest.rss')
    const spec = await (await request(app, '/api/openapi.json')).json() as any
    const mutation = await request(app, '/api/v1/feeds/latest', { method: 'POST' })

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('OPTIONS')
    expect(rss.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(rss.headers.get('access-control-allow-origin')).toBe('*')
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths)).toHaveLength(21)
    expect(spec.paths['/search'].get.security).toEqual([])
    expect(spec.paths['/feeds/latest.{format}'].get.parameters[0].schema.enum).toEqual(['rss', 'atom'])
    expect(mutation.status).toBe(405)
    expect(mutation.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    const missing = await request(app, '/api/v1/unknown')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'API endpoint not found' } })
  })

  test('rate limits JSON requests independently by IP', async () => {
    const { app, database } = fixture(() => 61_000)
    for (let i = 0; i < 120; i++) {
      expect((await request(app, '/api/v1/feeds/latest', { headers: { 'x-textlog-client-ip': 'busy' } })).status).toBe(200)
    }
    const limited = await request(app, '/api/v1/feeds/latest', { headers: { 'x-textlog-client-ip': 'busy' } })
    const other = await request(app, '/api/v1/feeds/latest', { headers: { 'x-textlog-client-ip': 'other' } })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(other.status).toBe(200)
    expect((database.query('SELECT count(*) count FROM api_rate_limit_buckets').get() as { count: number }).count).toBe(
      2,
    )
  })

  test('streams ready and live post events with non-buffering headers', async () => {
    const { app, database } = fixture()
    const controller = new AbortController()
    const response = await request(app, '/api/v1/firehose', { signal: controller.signal,
      headers: { 'x-textlog-client-ip': 'streamer' } })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const ready = decoder.decode((await reader.read()).value)
    expect(ready).toContain('event: ready')
    expect(response.headers.get('cache-control')).toContain('no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')

    database.run(
      'INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES(6,1,NULL,\'live #textlog\',\'2026-08-03 16:00:00\')',
    )
    publishPost(6)
    const event = decoder.decode((await reader.read()).value)
    expect(event).toContain('id: 6')
    expect(event).toContain('event: post')
    expect(event).toContain('live #textlog')
    await reader.cancel()
  })

  test('limits simultaneous firehose connections per IP and releases cancelled streams', async () => {
    const { app } = fixture()
    const responses = await Promise.all([1, 2, 3].map(() =>
      request(app, '/api/v1/firehose', {
        headers: { 'x-textlog-client-ip': 'crowded' },
      })
    ))
    expect(responses.every(response => response.status === 200)).toBe(true)
    const limited = await request(app, '/api/v1/firehose', { headers: { 'x-textlog-client-ip': 'crowded' } })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('30')

    await responses[0].body!.cancel()
    const replacement = await request(app, '/api/v1/firehose', { headers: { 'x-textlog-client-ip': 'crowded' } })
    expect(replacement.status).toBe(200)
    await Promise.all([...responses.slice(1), replacement].map(response => response.body!.cancel()))
  })
})
