import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { publishPost } from './api-broker'
import { rebuildHotPosts } from './hot'
import { registerApiRoutes } from './routes/api'
import { sessionHash } from './sessions'

function fixture(now?: () => number) {
  const database = new Database(':memory:', { strict: true })
  database.run(`
    CREATE TABLE users (id INTEGER PRIMARY KEY,handle TEXT NOT NULL,email TEXT,bio TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,suspended_at TEXT,is_bot INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,handle_chosen_at TEXT);
    CREATE TABLE handle_history (handle TEXT PRIMARY KEY COLLATE NOCASE,user_id INTEGER NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,parent_id INTEGER,body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
    CREATE TABLE follows (follower_id INTEGER NOT NULL,following_id INTEGER NOT NULL,created_at TEXT);
    CREATE TABLE blocks (blocker_id INTEGER NOT NULL,blocked_id INTEGER NOT NULL);
    CREATE TABLE post_hashtags (post_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE post_mentions (post_id INTEGER NOT NULL,user_id INTEGER NOT NULL);
    CREATE TABLE hashtag_follows (user_id INTEGER NOT NULL,tag TEXT NOT NULL,created_at TEXT);
    CREATE TABLE blocked_hashtags (user_id INTEGER NOT NULL,tag TEXT NOT NULL);
    CREATE TABLE for_you_reads (user_id INTEGER NOT NULL,event_key TEXT NOT NULL);
    CREATE TABLE activity_reads (user_id INTEGER NOT NULL,event_key TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,user_agent TEXT NOT NULL,last_used_at INTEGER NOT NULL);
    CREATE TABLE auth_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE api_rate_limit_buckets (scope TEXT NOT NULL,key_hash TEXT NOT NULL,bucket_start INTEGER NOT NULL,
      count INTEGER NOT NULL,PRIMARY KEY(scope,key_hash,bucket_start));
    CREATE TABLE post_hot (post_id INTEGER PRIMARY KEY,score REAL NOT NULL DEFAULT 0,reply_count INTEGER NOT NULL DEFAULT 0,
      activity_count INTEGER NOT NULL DEFAULT 0,
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
    INSERT INTO post_hot SELECT id,0,0,0,created_at,created_at FROM posts;
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
    expect(payload.data.find((post: any) => post.id === 2).top_id).toBe(1)
    expect(payload.data.find((post: any) => post.id === 2).parent).toMatchObject({ id: 1 })
    expect(payload.data.find((post: any) => post.id === 2).parent.parent).toBeUndefined()
    expect(payload.data.find((post: any) => post.id === 1).parent).toBeNull()
    expect(payload.data[2]).toMatchObject({
      top_id: null,
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

  test('excludes bot posts from the latest feed', async () => {
    const { app, database } = fixture()
    database.run("UPDATE users SET is_bot=1 WHERE id=2")

    const first = await (await request(app, '/api/v1/feeds/latest?limit=1')).json() as any
    const second = await (await request(app,
      `/api/v1/feeds/latest?limit=1&cursor=${encodeURIComponent(first.pagination.next_cursor)}`)).json() as any

    expect(first.data.map((post: any) => post.id)).toEqual([3])
    expect(second.data.map((post: any) => post.id)).toEqual([1])
    expect(second.pagination.next_cursor).toBeNull()
  })

  test('requires authentication for personalized activity and returns the web activity shape', async () => {
    const { app, database } = fixture()
    const token = 'personalized-feed-token'
    const now = Date.now()
    database.query(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at,user_agent,last_used_at)
      VALUES(?,?,?,?,?,?)`).run(sessionHash(token), 1, now + 60_000, now, 'test', now)
    database.run(`INSERT INTO post_mentions(post_id,user_id) VALUES(2,1);
      INSERT INTO follows(follower_id,following_id,created_at) VALUES
        (1,2,'2026-08-03 09:00:00'),(2,1,'2026-08-03 17:00:00');
      INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
        (6,2,NULL,'followed author','2026-08-03 15:00:00'),
        (7,2,NULL,'tag match #textlog','2026-08-03 16:00:00');
      INSERT INTO post_hashtags(post_id,tag) VALUES(7,'textlog');
      INSERT INTO hashtag_follows(user_id,tag,created_at) VALUES
        (1,'textlog','2026-08-03 08:00:00'),(2,'textlog','2026-08-03 18:00:00');`)
    const headers = { authorization: `Bearer ${token}` }

    expect((await request(app, '/api/v1/activities/for-you')).status).toBe(401)
    expect((await request(app, '/api/v1/activities/to-me')).status).toBe(401)
    const forYou = await (await request(app, '/api/v1/activities/for-you', { headers })).json() as any
    const toMe = await (await request(app, '/api/v1/activities/to-me', { headers })).json() as any

    expect(forYou.data.map((activity: any) => activity.type))
      .toEqual(['tag_follow', 'user_follow', 'post', 'post', 'reply'])
    expect(forYou.data.find((activity: any) => activity.type === 'tag_follow').payload)
      .toMatchObject({ actor: { handle: 'bob' }, target: { tag: 'textlog' } })
    expect(forYou.data.find((activity: any) => activity.type === 'post').payload).toMatchObject({ id: 7 })
    expect(toMe.data.map((activity: any) => activity.type)).toEqual(['user_follow', 'reply'])
    expect(toMe.data.find((activity: any) => activity.type === 'user_follow').payload)
      .toMatchObject({ actor: { handle: 'bob' }, target: { handle: 'alice' } })
    expect(forYou.has_unread).toBe(true)
    expect(toMe.has_unread).toBe(true)
    const firstPage = await (await request(app, '/api/v1/activities/for-you?limit=2', { headers })).json() as any
    const secondPage = await (await request(app,
      `/api/v1/activities/for-you?limit=2&cursor=${encodeURIComponent(firstPage.pagination.next_cursor)}`,
      { headers })).json() as any
    expect(firstPage.data.map((activity: any) => activity.type)).toEqual(['tag_follow', 'user_follow'])
    expect(secondPage.data.map((activity: any) => activity.payload.id)).toEqual([7, 6])
    expect((await request(app, '/api/v1/activities/for-you?cursor=broken', { headers })).status).toBe(400)

    const selectedRead = await request(app, '/api/v1/activities/for-you/read', { method: 'POST', headers: {
      ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ activity_ids: [forYou.data[0].id] }) })
    expect(selectedRead.status).toBe(200)
    expect(selectedRead.headers.get('cache-control')).toBe('no-store')
    expect(await selectedRead.json()).toEqual({ data: { read: 1 } })
    const afterSelectedRead = await (await request(app, '/api/v1/activities/for-you', { headers })).json() as any
    expect(afterSelectedRead.data[0].unread).toBe(false)

    expect((await request(app, '/api/v1/activities/for-you/read-all', { method: 'POST', headers })).status).toBe(200)
    const afterForYouReadAll = await (await request(app, '/api/v1/activities/for-you', { headers })).json() as any
    const toMeIds = new Set(toMe.data.map((activity: any) => activity.id))
    expect(afterForYouReadAll.data.filter((activity: any) => !toMeIds.has(activity.id))
      .every((activity: any) => !activity.unread)).toBe(true)
    expect(afterForYouReadAll.data.find((activity: any) => activity.type === 'reply').unread).toBe(true)
    expect(afterForYouReadAll.has_unread).toBe(false)

    const reply = toMe.data.find((activity: any) => activity.type === 'reply')
    expect((await request(app, '/api/v1/activities/to-me/read', { method: 'POST', headers: {
      ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ activity_ids: [reply.id] }) })).status)
      .toBe(200)
    expect((await request(app, '/api/v1/activities/to-me/read-all', { method: 'POST', headers })).status).toBe(200)
    const afterToMeReadAll = await (await request(app, '/api/v1/activities/to-me', { headers })).json() as any
    expect(afterToMeReadAll.data.every((activity: any) => !activity.unread)).toBe(true)
    expect(afterToMeReadAll.has_unread).toBe(false)
    expect((await request(app, '/api/v1/activities/for-you/read', { method: 'POST', headers })).status).toBe(400)
  })

  test('returns hot posts using the existing activity ranking with cursor pagination', async () => {
    const { app } = fixture()
    const firstResponse = await request(app, '/api/v1/feeds/hot?limit=2')
    const first = await firstResponse.json() as any
    expect(firstResponse.status).toBe(200)
    expect(first.data).toHaveLength(1)
    expect(first.data[0].id).toBe(1)
    expect(first.data[0].reply_count).toBe(1)
    expect(first.pagination.next_cursor).toBeNull()
    expect((await request(app, '/api/v1/feeds/hot?cursor=broken')).status).toBe(400)
  })

  test('searches public posts without authentication and paginates results', async () => {
    const { app } = fixture()
    const firstResponse = await request(app, '/api/v1/search?q=a&limit=1')
    const first = await firstResponse.json() as any
    expect(firstResponse.status).toBe(200)
    expect(first.data).toHaveLength(1)
    expect(first.pagination.next_cursor).toBeTruthy()
    const second =
      await (await request(app,
        `/api/v1/search?q=a&limit=1&cursor=${encodeURIComponent(first.pagination.next_cursor)}`)).json() as any
    expect(second.data).toHaveLength(1)
    expect(second.data[0].id).not.toBe(first.data[0].id)
    expect((await request(app, '/api/v1/search')).status).toBe(400)
    expect((await request(app, '/api/v1/search?q=!!!')).status).toBe(400)
    expect((await request(app, `/api/v1/search?q=${'x'.repeat(101)}`)).status).toBe(400)
  })

  test('serves single posts, replies, users, and tags with documented errors', async () => {
    const { app, database } = fixture()
    database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at)
      VALUES(6,1,2,'alice replies','2026-08-03 14:30:00')`)
    const post = await (await request(app, '/api/v1/posts/1')).json() as any
    const reply = await (await request(app, '/api/v1/posts/2')).json() as any
    const replies = await (await request(app, '/api/v1/posts/1/replies')).json() as any
    const user = await (await request(app, '/api/v1/users/ALICE')).json() as any
    const userPosts = await (await request(app, '/api/v1/users/alice/posts')).json() as any
    const userNotes = await (await request(app, '/api/v1/users/alice/notes')).json() as any
    const userReplies = await (await request(app, '/api/v1/users/alice/replies')).json() as any
    const tags = await (await request(app, '/api/v1/tags/textlog/posts')).json() as any

    expect(post.data.id).toBe(1)
    expect(post.data.top_id).toBeNull()
    expect(reply.data.top_id).toBe(1)
    expect(reply.data.parent).toMatchObject({ id: 1, body: 'hello #textlog @bob' })
    expect(replies.data.map((item: any) => item.id)).toEqual([2])
    expect(user.data).toMatchObject({ handle: 'alice', bio: 'builder', post_count: 2, replies_count: 1,
      follower_count: 1, following_user_count: 0, following_tag_count: 0, following_count: 0 })
    expect(user.data.email).toBeUndefined()
    expect(userPosts.data.map((item: any) => item.id)).toEqual([3, 1])
    expect(userNotes).toEqual(userPosts)
    expect(userReplies.data.map((item: any) => item.id)).toEqual([6])
    expect(tags.data.map((item: any) => item.id)).toEqual([1])
    expect((await request(app, '/api/v1/posts/nope')).status).toBe(400)
    expect((await request(app, '/api/v1/posts/5')).status).toBe(404)
    expect((await request(app, '/api/v1/users/gone')).status).toBe(404)
    const oldProfile = await request(app, '/api/v1/users/oldalice')
    const oldPosts = await request(app, '/api/v1/users/oldalice/posts?limit=5')
    const oldNotes = await request(app, '/api/v1/users/oldalice/notes?limit=5')
    const oldReplies = await request(app, '/api/v1/users/oldalice/replies?limit=5')
    expect(oldProfile.status).toBe(308)
    expect(oldProfile.headers.get('location')).toBe('/api/v1/users/Alice')
    expect(oldPosts.status).toBe(308)
    expect(oldPosts.headers.get('location')).toBe('/api/v1/users/Alice/posts?limit=5')
    expect(oldNotes.status).toBe(308)
    expect(oldNotes.headers.get('location')).toBe('/api/v1/users/Alice/notes?limit=5')
    expect(oldReplies.status).toBe(308)
    expect(oldReplies.headers.get('location')).toBe('/api/v1/users/Alice/replies?limit=5')
  })

  test('lists followed users and tags, user followers, and tag followers', async () => {
    const { app, database } = fixture()
    database.run(`INSERT INTO users(id,handle,email,bio) VALUES(4,'Dana','dana@example.com','');
      INSERT INTO follows(follower_id,following_id) VALUES(1,2),(1,4),(4,1);
      INSERT INTO hashtag_follows(user_id,tag) VALUES
        (1,'textlog'),(1,'quiet'),(2,'textlog'),(4,'textlog');`)

    const following = await (await request(app, '/api/v1/users/alice/following/users')).json() as any
    const followers = await (await request(app, '/api/v1/users/alice/followers')).json() as any
    const tagFollowers = await (await request(app, '/api/v1/tags/textlog/followers')).json() as any
    const firstTags = await (await request(app, '/api/v1/users/alice/following/tags?limit=1')).json() as any
    const secondTags = await (await request(app,
      `/api/v1/users/alice/following/tags?limit=1&cursor=${encodeURIComponent(firstTags.pagination.next_cursor)}`))
      .json() as any

    expect(following.data.map((item: any) => item.handle)).toEqual(['dana', 'bob'])
    expect(followers.data.map((item: any) => item.handle)).toEqual(['dana', 'bob'])
    expect(tagFollowers.data.map((item: any) => item.handle)).toEqual(['dana', 'bob', 'alice'])
    expect([...firstTags.data, ...secondTags.data].map((item: any) => item.tag)).toEqual(['quiet', 'textlog'])
    expect(firstTags.data[0]).toMatchObject({ follower_count: 1, post_count: 0,
      url: 'https://textlog.cc/tag/quiet', api_url: 'https://textlog.cc/api/v1/tags/quiet' })
    const user = await (await request(app, '/api/v1/users/alice')).json() as any
    const tag = await (await request(app, '/api/v1/tags/textlog')).json() as any
    expect(user.data).toMatchObject({ following_user_count: 2, following_tag_count: 2, follower_count: 2 })
    expect(tag.data).toMatchObject({ tag: 'textlog', post_count: 1, follower_count: 3,
      api_url: 'https://textlog.cc/api/v1/tags/textlog' })
    expect((await request(app, '/api/v1/users/gone/followers')).status).toBe(404)
    expect((await request(app, '/api/v1/tags/invalid-tag/followers')).status).toBe(400)
  })

  test('reports aggregate descendant counts without embedding reply bodies', async () => {
    const { app, database } = fixture()
    database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (6,1,2,'a nested reply','2026-08-03 14:30:00'),
      (7,2,6,'a deleted descendant','2026-08-03 14:40:00')`)
    database.run(`UPDATE posts SET deleted_at='2026-08-03 14:50:00' WHERE id=7`)
    database.run(`INSERT INTO post_hot VALUES(6,0,0,0,'2026-08-03 14:30:00','2026-08-03 14:30:00')`)
    rebuildHotPosts(database)

    const latest = await (await request(app, '/api/v1/feeds/latest')).json() as any
    const hot = await (await request(app, '/api/v1/feeds/hot')).json() as any
    const post = await (await request(app, '/api/v1/posts/1')).json() as any

    expect(latest.data.find((item: any) => item.id === 1).reply_count).toBe(2)
    expect(hot.data.find((item: any) => item.id === 1).reply_count).toBe(2)
    expect(post.data.reply_count).toBe(2)
    expect(post.data.replies).toBeUndefined()
  })

  test('returns reply trees with depth, parent IDs, and aggregate reply counts', async () => {
    const { app, database } = fixture()
    database.run(`INSERT INTO posts(id,user_id,parent_id,body,created_at) VALUES
      (6,1,2,'nested reply','2026-08-03 14:30:00'),
      (7,2,6,'deep reply','2026-08-03 14:40:00')`)

    const shallow = await (await request(app, '/api/v1/posts/1/replies')).json() as any
    expect(shallow.data.map((item: any) => ({ id: item.id, parent_id: item.parent_id, depth: item.depth,
      reply_count: item.reply_count })))
      .toEqual([{ id: 2, parent_id: 1, depth: 1, reply_count: 2 }])
    expect(shallow.truncated).toBeUndefined()

    const tree = await (await request(app, '/api/v1/posts/1/replies?depth=3')).json() as any
    expect(tree.data.map((item: any) => ({ id: item.id, parent_id: item.parent_id, depth: item.depth })))
      .toEqual([
        { id: 7, parent_id: 6, depth: 3 },
        { id: 6, parent_id: 2, depth: 2 },
        { id: 2, parent_id: 1, depth: 1 },
      ])
    expect(tree.data.every((item: any) => item.top_id === 1)).toBe(true)
    expect(tree.truncated).toBeUndefined()
    expect(tree.data.every((item: any) => item.truncated === undefined)).toBe(true)

    const limited = await (await request(app, '/api/v1/posts/1/replies?depth=3&limit=2')).json() as any
    expect(limited.pagination.next_cursor).toBeTruthy()
    expect((await request(app, '/api/v1/posts/1/replies?depth=0')).status).toBe(400)
    expect((await request(app, '/api/v1/posts/1/replies?depth=21')).status).toBe(400)
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
    expect(Object.keys(spec.paths)).toHaveLength(35)
    expect(spec.paths['/activities/for-you'].get.responses['401']).toBeDefined()
    expect(spec.paths['/activities/to-me'].get.responses['401']).toBeDefined()
    expect(spec.paths['/users/{handle}/blocks'].get.responses['403']).toBeDefined()
    expect(spec.paths['/activities/for-you/read-all'].post).toBeDefined()
    expect(spec.paths['/users/{handle}/following/tags'].get).toBeDefined()
    expect(spec.paths['/tags/{tag}/followers'].get).toBeDefined()
    expect(spec.components.schemas.User.required).toContain('following_tag_count')
    expect(spec.components.schemas.Tag.required).toContain('follower_count')
    expect(spec.components.schemas.Activity.properties.type.enum).toContain('user_follow')
    expect(spec.paths['/users/{handle}/posts'].get.deprecated).toBe(true)
    expect(spec.paths['/users/{handle}/notes'].get.summary).toBe("User's latest notes")
    expect(spec.paths['/users/{handle}/replies'].get.parameters.map((parameter: any) => parameter.name))
      .toEqual(['handle', 'limit', 'cursor'])
    expect(spec.paths['/search'].get.security).toEqual([])
    expect(spec.paths['/feeds/latest.{format}'].get.parameters[0].schema.enum).toEqual(['rss', 'atom'])
    const repliesOperation = spec.paths['/posts/{id}/replies'].get
    expect(repliesOperation.parameters.find((parameter: any) => parameter.name === 'depth').schema)
      .toMatchObject({ type: 'integer', minimum: 1, maximum: 20, default: 1 })
    const repliesSchema = repliesOperation.responses['200'].content['application/json'].schema
    expect(repliesSchema.required).toEqual(['data', 'pagination'])
    expect(repliesSchema.properties.truncated).toBeUndefined()
    expect(repliesSchema.properties.data.items.$ref).toBe('#/components/schemas/Reply')
    expect(spec.components.schemas.Reply.allOf[1].required).toEqual(['depth'])
    expect(spec.components.schemas.Reply.allOf[1].properties.truncated).toBeUndefined()
    expect(spec.components.schemas.Post.required).toContain('top_id')
    expect(spec.components.schemas.Post.required).toContain('parent')
    expect(spec.components.schemas.Post.properties.parent.anyOf[0].$ref).toBe('#/components/schemas/QuotedPost')
    expect(spec.components.schemas.User.required).toContain('replies_count')
    expect(spec.paths['/users/{handle}'].get.responses['200'].content['application/json'].schema.properties.data.$ref)
      .toBe('#/components/schemas/User')
    expect(mutation.status).toBe(405)
    expect(mutation.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    const missing = await request(app, '/api/v1/unknown')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'API endpoint not found' } })
  })

  test('rate limits JSON requests independently by IP', async () => {
    const { app, database } = fixture(() => 61_000)
    for (let i = 0; i < 120; i++) {
      expect((await request(app, '/api/v1/feeds/latest', { headers: { 'x-textlog-client-ip': 'busy' } })).status).toBe(
        200,
      )
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
