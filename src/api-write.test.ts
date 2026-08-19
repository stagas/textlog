import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { readFileSync, unlinkSync } from 'node:fs'
import { executeDatabaseDomain } from './database-domain'
import type { DatabaseService } from './database-service'
import { registerApiRoutes } from './routes/api'
import { WRITE_LIMIT } from './routes/api-write'
import { apiUser, hash } from './utils'

function fixture() {
  const database = new Database(':memory:')
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,email TEXT,bio TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,suspended_at TEXT,email_verified_at TEXT,
      handle_chosen_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,has_latex INTEGER,has_links INTEGER,has_code INTEGER);
    CREATE TABLE follows (follower_id INTEGER NOT NULL,following_id INTEGER NOT NULL,created_at TEXT,
      PRIMARY KEY(follower_id,following_id));
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL,blocked_id INTEGER NOT NULL,
      PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(user_id,tag));
    CREATE TABLE hashtag_follows (user_id INTEGER NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(user_id,tag));
    CREATE TABLE reports (reporter_id INTEGER NOT NULL,post_id INTEGER NOT NULL,reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,
      PRIMARY KEY(reporter_id,post_id));
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(post_id,tag));
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,PRIMARY KEY(post_id,user_id));
    CREATE TABLE for_you_reads (user_id INTEGER NOT NULL,event_key TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,event_key));
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,user_agent TEXT NOT NULL DEFAULT '',last_used_at INTEGER);
    CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,last_used_at INTEGER);
    CREATE TABLE magic_links (token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,user_id INTEGER,
      next_path TEXT NOT NULL DEFAULT '/',expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
      code_hash TEXT,attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE auth_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE api_rate_limit_buckets (scope TEXT NOT NULL,key_hash TEXT NOT NULL,bucket_start INTEGER NOT NULL,
      count INTEGER NOT NULL,PRIMARY KEY(scope,key_hash,bucket_start));
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,reply_count INTEGER NOT NULL DEFAULT 0,
      score_updated_at TEXT NOT NULL,latest_activity_at TEXT NOT NULL);
    INSERT INTO users(id,handle,email,email_verified_at,handle_chosen_at) VALUES
      (1,'alice','alice@example.com','2026-08-01','2026-08-01'),
      (2,'bob','bob@example.com','2026-08-01','2026-08-01');
    INSERT INTO posts(id,user_id,parent_id,body) VALUES (1,2,NULL,'a post by bob');
    INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES
      ('${hash('alice-token')}',1,${Date.now() + 86400000},${Date.now()}),
      ('${hash('bob-token')}',2,${Date.now() + 86400000},${Date.now()});
  `)
  const app = new Hono()
  const service: DatabaseService = { call: (operation, input) => executeDatabaseDomain(database, operation, input) }
  registerApiRoutes(app, 'https://textlog.test', Date.now, service, request => apiUser(request, database))
  return { app, database }
}

function call(app: Hono, path: string, options: {
  method?: string
  token?: string
  body?: unknown
  ip?: string
} = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  if (options.ip) headers['x-textlog-client-ip'] = options.ip
  return app.fetch(new Request(`https://textlog.test${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }))
}

const post = (app: Hono, token: string, body: unknown) => call(app, '/api/v1/posts', { method: 'POST', token, body })

beforeEach(() => {
  Bun.env.MODERATION_DISABLED = 'true'
})

describe('API writes', () => {
  test('refuses without a token, and never accepts a cookie', async () => {
    const { app } = fixture()

    expect((await post(app, '', { body: 'hi' })).status).toBe(401)

    const withCookie = await app.fetch(new Request('https://textlog.test/api/v1/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'textlog=alice-token' },
      body: JSON.stringify({ body: 'hi' }),
    }))
    expect(withCookie.status).toBe(401)
  })

  test('allows every account to use authenticated writes', async () => {
    const { app } = fixture()

    expect((await post(app, 'bob-token', { body: 'hi' })).status).toBe(201)
  })

  test('creates a post and returns it in the read shape', async () => {
    const { app, database } = fixture()
    const response = await post(app, 'alice-token', { body: 'hello #api from an app' })

    expect(response.status).toBe(201)
    const { data } = await response.json() as any
    expect(data).toMatchObject({ body: 'hello #api from an app', parent_id: null, tags: ['api'] })
    expect(data.author.handle).toBe('alice')
    expect(data.url).toBe(`https://textlog.test/post/${data.id}`)
    expect(database.query('SELECT user_id,event_key FROM for_you_reads WHERE user_id=?').get(1)).toEqual({
      user_id: 1,
      event_key: `post:${String(data.id).padStart(20, '0')}`,
    })
  })

  test('replies, and refuses to reply to a post that is gone', async () => {
    const { app } = fixture()

    const reply = await post(app, 'alice-token', { body: 'a reply', parent_id: 1 })
    expect(reply.status).toBe(201)
    expect((await reply.json() as any).data.parent_id).toBe(1)

    expect((await post(app, 'alice-token', { body: 'x', parent_id: 999 })).status).toBe(404)
  })

  test('keeps the same posting limit as the website', async () => {
    const { app } = fixture()
    for (let i = 0; i < 5; i++) {
      expect((await post(app, 'alice-token', { body: `post ${i}` })).status).toBe(201)
    }
    const limited = await post(app, 'alice-token', { body: 'one too many' })

    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(await limited.json()).toMatchObject({ error: { code: 'post_rate_limited' } })
  })

  test('returns the original post when the same body is sent twice', async () => {
    const { app } = fixture()
    const first = await post(app, 'alice-token', { body: 'say it once' })
    const again = await post(app, 'alice-token', { body: 'say it once' })

    expect(again.status).toBe(200)
    expect((await again.json() as any).data.id).toBe((await first.json() as any).data.id)
  })

  test('rejects bodies outside 1 to 280 characters', async () => {
    const { app } = fixture()

    expect((await post(app, 'alice-token', { body: '   ' })).status).toBe(400)
    expect((await post(app, 'alice-token', { body: 'x'.repeat(281) })).status).toBe(400)
  })

  test('rejects posts over ten lines with a useful server error', async () => {
    const { app } = fixture()
    const response = await post(app, 'alice-token', { body: Array(11).fill('x').join('\n') })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'invalid_body',
        message: 'The note exceeds the limit: 11/10 lines.',
      },
    })
  })

  test('edits and deletes only your own posts', async () => {
    const { app } = fixture()
    const created = (await (await post(app, 'alice-token', { body: 'mine' })).json() as any).data

    const edited = await call(app, `/api/v1/posts/${created.id}`, {
      method: 'PATCH',
      token: 'alice-token',
      body: { body: 'mine, edited' },
    })
    expect((await edited.json() as any).data.body).toBe('mine, edited')

    expect((await call(app, '/api/v1/posts/1', { method: 'PATCH', token: 'alice-token', body: { body: 'no' } }))
      .status).toBe(403)
    expect((await call(app, '/api/v1/posts/1', { method: 'DELETE', token: 'alice-token' })).status).toBe(403)

    expect((await call(app, `/api/v1/posts/${created.id}`, { method: 'DELETE', token: 'alice-token' })).status).toBe(
      200,
    )
    expect((await call(app, `/api/v1/posts/${created.id}`)).status).toBe(404)
  })

  test('follows, unfollows and refuses to follow yourself', async () => {
    const { app, database } = fixture()

    expect((await call(app, '/api/v1/users/bob/follow', { method: 'POST', token: 'alice-token' })).status).toBe(200)
    expect(database.query('SELECT 1 FROM follows WHERE follower_id=1 AND following_id=2').get()).toBeTruthy()

    expect((await call(app, '/api/v1/users/bob/follow', { method: 'DELETE', token: 'alice-token' })).status).toBe(200)
    expect(database.query('SELECT 1 FROM follows WHERE follower_id=1 AND following_id=2').get()).toBeNull()

    expect((await call(app, '/api/v1/users/alice/follow', { method: 'POST', token: 'alice-token' })).status).toBe(403)
  })

  test('blocking drops the follow, and a blocked pair cannot reply', async () => {
    const { app, database } = fixture()
    await call(app, '/api/v1/users/bob/follow', { method: 'POST', token: 'alice-token' })

    expect((await call(app, '/api/v1/users/bob/block', { method: 'POST', token: 'alice-token' })).status).toBe(200)
    expect(database.query('SELECT 1 FROM follows WHERE follower_id=1 AND following_id=2').get()).toBeNull()

    expect((await post(app, 'alice-token', { body: 'reply', parent_id: 1 })).status).toBe(404)
    database.query('INSERT INTO blocked_hashtags(user_id,tag) VALUES(?,?)').run(1, 'muted')

    expect((await call(app, '/api/v1/users/alice/blocks')).status).toBe(401)
    expect((await call(app, '/api/v1/users/bob/blocks', { token: 'alice-token' })).status).toBe(403)
    const blocksResponse = await call(app, '/api/v1/users/alice/blocks', { token: 'alice-token' })
    const blocks = await blocksResponse.json() as any
    expect(blocksResponse.headers.get('cache-control')).toBe('no-store')
    expect(blocks).toEqual({
      data: [{ handle: 'bob', url: 'https://textlog.test/u/bob', api_url: 'https://textlog.test/api/v1/users/bob' }],
      pagination: { next_cursor: null },
    })
    const ownProfileResponse = await call(app, '/api/v1/users/alice', { token: 'alice-token' })
    const ownProfile = await ownProfileResponse.json() as any
    expect(ownProfile.data).toMatchObject({ blocked_user_count: 1, blocked_tag_count: 1 })
    expect(ownProfileResponse.headers.get('cache-control')).toBe('no-store')
    const publicProfile = await (await call(app, '/api/v1/users/alice')).json() as any
    expect(publicProfile.data.blocked_user_count).toBeUndefined()
    expect(publicProfile.data.blocked_tag_count).toBeUndefined()
  })

  test('reports a post, but not your own', async () => {
    const { app, database } = fixture()

    expect((await call(app, '/api/v1/posts/1/report', {
      method: 'POST',
      token: 'alice-token',
      body: { reason: 'spam' },
    })).status).toBe(200)
    expect(database.query('SELECT reason FROM reports WHERE reporter_id=1 AND post_id=1').get())
      .toMatchObject({ reason: 'spam' })

    expect((await call(app, '/api/v1/posts/1/report', {
      method: 'POST',
      token: 'alice-token',
      body: { reason: 'nonsense' },
    })).status).toBe(400)

    const mine = (await (await post(app, 'alice-token', { body: 'mine' })).json() as any).data
    expect((await call(app, `/api/v1/posts/${mine.id}/report`, {
      method: 'POST',
      token: 'alice-token',
      body: { reason: 'spam' },
    })).status).toBe(400)
  })

  test('reads and updates the signed-in account', async () => {
    const { app } = fixture()

    const me = await call(app, '/api/v1/me', { token: 'alice-token' })
    const account = await me.json() as any
    expect(account).toMatchObject({ data: { handle: 'alice', can_post: true } })
    expect(account.data).not.toHaveProperty('api_writes_enabled')

    const updated = await call(app, '/api/v1/me', { method: 'PATCH', token: 'alice-token', body: { bio: 'builder' } })
    expect((await updated.json() as any).data.bio).toBe('builder')

    const oversized = await call(app, '/api/v1/me', {
      method: 'PATCH',
      token: 'alice-token',
      body: { bio: 'x'.repeat(161) },
    })
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({
      error: { code: 'invalid_bio', message: 'The bio exceeds the limit: 161/160 characters.' },
    })

    const tooManyLines = await call(app, '/api/v1/me', {
      method: 'PATCH',
      token: 'alice-token',
      body: { bio: Array(6).fill('x').join('\n') },
    })
    expect(tooManyLines.status).toBe(400)
    expect(await tooManyLines.json()).toMatchObject({
      error: { code: 'invalid_bio', message: 'The bio exceeds the limit: 6/5 lines.' },
    })
  })

  test('revoking a token stops it working', async () => {
    const { app } = fixture()

    expect((await call(app, '/api/v1/auth/session', { method: 'DELETE', token: 'alice-token' })).status).toBe(200)
    expect((await call(app, '/api/v1/me', { token: 'alice-token' })).status).toBe(401)
  })

  test('caps writes per account', async () => {
    const { app, database } = fixture()
    for (let i = 0; i < WRITE_LIMIT; i++) {
      await call(app, '/api/v1/users/bob/follow', { method: 'POST', token: 'alice-token' })
    }
    const limited = await call(app, '/api/v1/users/bob/follow', { method: 'POST', token: 'alice-token' })

    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } })
    expect(database.query('SELECT count(*) count FROM api_rate_limit_buckets WHERE scope=\'api-write\'').get())
      .toMatchObject({ count: 1 })
  })
})

describe('API sign in', () => {
  test('answers the same whether or not the address has an account', async () => {
    const { app } = fixture()
    Bun.env.NODE_ENV = 'test'
    const capturePath = `/tmp/textlog-api-auth-${Date.now()}.jsonl`
    Bun.env.EMAIL_CAPTURE_PATH = capturePath

    const known = await call(app, '/api/v1/auth/request', {
      method: 'POST',
      body: { email: 'alice@example.com' },
      ip: 'a',
    })
    const unknown = await call(app, '/api/v1/auth/request', {
      method: 'POST',
      body: { email: 'nobody@example.com' },
      ip: 'b',
    })

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    expect(await known.json()).toEqual(await unknown.json())
    const messages = readFileSync(capturePath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(messages).toHaveLength(1)
    expect(messages[0].subject).toBe('Welcome back, @alice · textlog')
    delete Bun.env.EMAIL_CAPTURE_PATH
    unlinkSync(capturePath)
  })

  test('exchanges a code for a token that can write', async () => {
    const { app, database } = fixture()
    database.query(`INSERT INTO magic_links(token_hash,email,user_id,expires_at,created_at,code_hash)
      VALUES('link','alice@example.com',1,?,?,?)`).run(Date.now() + 600000, Date.now(), hash('123456'))

    const verified = await call(app, '/api/v1/auth/verify', {
      method: 'POST',
      body: { email: 'alice@example.com', code: '123456' },
      ip: 'c',
    })
    expect(verified.status).toBe(200)
    const { data } = await verified.json() as any
    expect(data.user.handle).toBe('alice')

    expect((await post(app, data.token, { body: 'posted with a fresh token' })).status).toBe(201)
    expect(database.query('SELECT 1 FROM magic_links WHERE token_hash=\'link\'').get()).toBeNull()
  })

  test('a wrong code fails, and the code dies after five tries', async () => {
    const { app, database } = fixture()
    database.query(`INSERT INTO magic_links(token_hash,email,user_id,expires_at,created_at,code_hash)
      VALUES('link','alice@example.com',1,?,?,?)`).run(Date.now() + 600000, Date.now(), hash('123456'))

    for (let i = 0; i < 5; i++) {
      const wrong = await call(app, '/api/v1/auth/verify', {
        method: 'POST',
        body: { email: 'alice@example.com', code: '000000' },
        ip: `try-${i}`,
      })
      expect(wrong.status).toBe(400)
    }

    expect(database.query('SELECT 1 FROM magic_links WHERE token_hash=\'link\'').get()).toBeNull()
    expect((await call(app, '/api/v1/auth/verify', {
      method: 'POST',
      body: { email: 'alice@example.com', code: '123456' },
      ip: 'after',
    })).status).toBe(400)
  })

  test('an expired code is refused', async () => {
    const { app, database } = fixture()
    database.query(`INSERT INTO magic_links(token_hash,email,user_id,expires_at,created_at,code_hash)
      VALUES('link','alice@example.com',1,?,?,?)`).run(Date.now() - 1000, Date.now(), hash('123456'))

    expect((await call(app, '/api/v1/auth/verify', {
      method: 'POST',
      body: { email: 'alice@example.com', code: '123456' },
      ip: 'd',
    })).status).toBe(400)
  })
})
