import type { Database } from 'bun:sqlite'
import type { Context, Hono } from 'hono'
import { apiHotPosts, apiOrigin, apiPost, apiPosts, apiSearchPosts, isoTimestamp, parseCollectionParams } from '../api'
import { subscribeToPosts } from '../api-broker'
import { consumeBucketedAttempt, rateLimitKey } from '../auth-rate-limit'
import { ApiDocs } from '../components/pages'
import { db } from '../db'
import { resolveHandle } from '../handles'
import { decodeHotCursor } from '../hot'
import { logError } from '../log'
import { currentUser } from '../utils'
import { page } from './shared'
import { MAX_SEARCH_LENGTH, normalizeSearchQuery, searchExpression } from '../search'
import { registerApiWriteRoutes } from './api-write'
import { registerSyndicationRoutes } from './syndication'

const JSON_LIMIT = 120
const JSON_WINDOW_SECONDS = 60
const SSE_LIMIT = 3
const SSE_RETRY_AFTER = 30
const SSE_HEARTBEAT_MS = 5_000
const activeStreams = new Map<string, number>()

function jsonResponse(value: unknown, status = 200, cache = 'public, max-age=15, stale-while-revalidate=30') {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  })
}

function apiError(code: string, message: string, status: number, retryAfter?: number) {
  const response = jsonResponse({ error: { code, message } }, status, 'no-store')
  if (retryAfter !== undefined) response.headers.set('retry-after', String(retryAfter))
  return response
}

function collection(c: Context, database: Database, filters: { handle?: string; parentId?: number; tag?: string } = {},
  appUrl?: string | null)
{
  const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
  if (!parsed) {
    return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
  }
  return jsonResponse(apiPosts(database, apiOrigin(c.req.url, appUrl), { ...parsed, ...filters }))
}

function openApiDocument() {
  const postSchema = {
    type: 'object',
    required: ['id', 'body', 'created_at', 'parent_id', 'reply_count', 'tags', 'mentions', 'url', 'api_url', 'author'],
    properties: {
      id: { type: 'integer' },
      body: { type: 'string', maxLength: 280 },
      created_at: { type: 'string', format: 'date-time' },
      parent_id: { type: ['integer', 'null'] },
      reply_count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      mentions: { type: 'array', items: { type: 'string' } },
      url: { type: 'string', format: 'uri' },
      api_url: { type: 'string', format: 'uri' },
      author: { type: 'object', required: ['handle', 'url', 'api_url'], properties: {
        handle: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        api_url: { type: 'string', format: 'uri' },
      } },
    },
  }
  const collectionParameters = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
  ]
  const jsonResponses = { '200': { description: 'Successful response' }, '400': { description: 'Invalid request' },
    '404': { description: 'Not found' }, '429': { description: 'Rate limited' } }
  const formatParameter = { name: 'format', in: 'path', required: true,
    schema: { type: 'string', enum: ['rss', 'atom'] } }
  const postIdParameter = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
  const handleParameter = { name: 'handle', in: 'path', required: true, schema: { type: 'string' } }
  const writeResponses = { ...jsonResponses, '401': { description: 'Missing or invalid token' },
    '403': { description: 'The authenticated account cannot perform this operation' } }
  const syndicationResponses = { '200': { description: 'RSS 2.0 or Atom 1.0 XML feed', content: {
    'application/rss+xml': { schema: { type: 'string' } },
    'application/atom+xml': { schema: { type: 'string' } },
  } }, '404': { description: 'Not found' }, '429': { description: 'Rate limited' } }
  return {
    openapi: '3.1.0',
    info: { title: 'textlog public API', version: '1.1.0',
      description: 'Public reads and authenticated writes for every account.' },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/feeds/latest': { get: { summary: 'Latest posts', parameters: collectionParameters, responses: jsonResponses } },
      '/feeds/hot': { get: { summary: 'Hot posts', parameters: collectionParameters, responses: jsonResponses } },
      '/search': { get: { summary: 'Search public posts', security: [], parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1,
          maxLength: MAX_SEARCH_LENGTH } },
        ...collectionParameters,
      ], responses: jsonResponses } },
      '/feeds/latest.{format}': {
        get: { summary: 'Latest posts as RSS or Atom', parameters: [formatParameter], responses: syndicationResponses },
      },
      '/feeds/hot.{format}': {
        get: { summary: 'Hot posts as RSS or Atom', parameters: [formatParameter], responses: syndicationResponses },
      },
      '/posts/{id}': {
        get: { summary: 'Single post', parameters: [postIdParameter], responses: jsonResponses },
        patch: { summary: 'Edit your own post', parameters: [postIdParameter], responses: writeResponses },
        delete: { summary: 'Delete your own post', parameters: [postIdParameter], responses: writeResponses },
      },
      '/posts/{id}/replies': {
        get: { summary: 'Post replies',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/users/{handle}': {
        get: { summary: 'Public profile',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
          responses: jsonResponses },
      },
      '/users/{handle}/posts': {
        get: { summary: 'User\'s latest posts',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/users/{handle}/posts.{format}': { get: { summary: 'User\'s latest posts as RSS or Atom', parameters: [
        { name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
        formatParameter,
      ], responses: syndicationResponses } },
      '/tags/{tag}/posts': {
        get: { summary: 'Posts with a hashtag',
          parameters: [{ name: 'tag', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/tags/{tag}/posts.{format}': { get: { summary: 'Hashtag posts as RSS or Atom', parameters: [
        { name: 'tag', in: 'path', required: true, schema: { type: 'string' } },
        formatParameter,
      ], responses: syndicationResponses } },
      '/firehose': {
        get: { summary: 'Live post stream', responses: {
          '200': { description: 'Server-sent events',
            content: { 'text/event-stream': { schema: { type: 'string' } } } },
          '429': { description: 'Too many streams' },
        } },
      },
      '/auth/request': {
        post: { summary: 'Email a sign-in code to an existing account', security: [], responses: writeResponses },
      },
      '/auth/verify': {
        post: { summary: 'Exchange a sign-in code for a session token', security: [], responses: writeResponses },
      },
      '/auth/session': { delete: { summary: 'Revoke the current token', responses: writeResponses } },
      '/me': {
        get: { summary: 'The signed-in account', responses: writeResponses },
        patch: { summary: 'Update your bio', responses: writeResponses },
      },
      '/posts': { post: { summary: 'Create a post or reply', responses: writeResponses } },
      '/posts/{id}/report': {
        post: { summary: 'Report a post', parameters: [postIdParameter], responses: writeResponses },
      },
      '/users/{handle}/follow': {
        post: { summary: 'Follow a user', parameters: [handleParameter], responses: writeResponses },
        delete: { summary: 'Unfollow a user', parameters: [handleParameter], responses: writeResponses },
      },
      '/users/{handle}/block': {
        post: { summary: 'Block a user', parameters: [handleParameter], responses: writeResponses },
        delete: { summary: 'Unblock a user', parameters: [handleParameter], responses: writeResponses },
      },
    },
    security: [{ bearerAuth: [] }],
    components: {
      schemas: { Post: postSchema },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  }
}

export function registerApiRoutes(app: Hono, database: Database = db,
  appUrl: string | null | undefined = Bun.env.APP_URL, now: () => number = Date.now)
{
  app.get('/api', c => page(<ApiDocs user={currentUser(c.req.raw)} />))

  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'Accept, Authorization, Content-Type',
        'access-control-max-age': '86400',
      } })
    }
    try {
      await next()
    }
    catch (error) {
      logError(`${c.req.method} ${c.req.path}`, error)
      c.res = apiError('internal_error', 'Something went wrong', 500)
    }
    c.header('access-control-allow-origin', '*')
    c.header('vary', 'Origin')
  })

  app.use('/api/v1/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path === '/api/v1/firehose') return next()
    const ip = c.req.header('x-textlog-client-ip') || '-'
    const limited = consumeBucketedAttempt(
      database, 'api-json', rateLimitKey(ip), JSON_LIMIT, JSON_WINDOW_SECONDS, now(),
    )
    if (limited) return apiError('rate_limited', 'Too many API requests', 429, limited.retryAfter)
    return next()
  })

  registerSyndicationRoutes(app, database, appUrl)
  registerApiWriteRoutes(app, database, appUrl)

  app.get('/api/openapi.json', () => jsonResponse(openApiDocument(), 200, 'public, max-age=3600'))

  app.get('/api/v1/feeds/latest', c => collection(c, database, {}, appUrl))

  app.get('/api/v1/search', c => {
    const rawQuery = c.req.query('q') || ''
    const query = normalizeSearchQuery(rawQuery)
    if (!query || rawQuery.trim().length > MAX_SEARCH_LENGTH || !searchExpression(query)) {
      return apiError('invalid_query', `q must contain searchable text up to ${MAX_SEARCH_LENGTH} characters`, 400)
    }
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    return jsonResponse(apiSearchPosts(
      database, apiOrigin(c.req.url, appUrl), query, parsed.limit, parsed.before || 0,
    ))
  })

  app.get('/api/v1/feeds/hot', c => {
    const parsed = parseCollectionParams(c.req.query('limit'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodeHotCursor(cursorValue)
    if (cursorValue && !cursor) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    return jsonResponse(apiHotPosts(database, apiOrigin(c.req.url, appUrl), parsed.limit, cursor))
  })

  app.get('/api/v1/posts/:id', c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return apiError('invalid_post_id', 'Post ID must be a positive integer', 400)
    const post = apiPost(database, id, apiOrigin(c.req.url, appUrl))
    return post ? jsonResponse({ data: post }) : apiError('not_found', 'Post not found', 404)
  })

  app.get('/api/v1/posts/:id/replies', c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return apiError('invalid_post_id', 'Post ID must be a positive integer', 400)
    if (!apiPost(database, id, apiOrigin(c.req.url, appUrl))) return apiError('not_found', 'Post not found', 404)
    return collection(c, database, { parentId: id }, appUrl)
  })

  app.get('/api/v1/users/:handle', c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = resolveHandle(database, handle)
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}`, 308)
    }
    const found = database.query(`SELECT u.handle,u.bio,u.created_at,
      (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) post_count,
      (SELECT count(*) FROM follows f JOIN users follower ON follower.id=f.follower_id
        WHERE f.following_id=u.id AND follower.deleted_at IS NULL) follower_count,
      (SELECT count(*) FROM follows f JOIN users followed ON followed.id=f.following_id
        WHERE f.follower_id=u.id AND followed.deleted_at IS NULL) following_count
      FROM users u WHERE u.id=? AND u.deleted_at IS NULL`).get(resolved.id) as {
      handle: string
      bio: string
      created_at: string
      post_count: number
      follower_count: number
      following_count: number
    } | null
    if (!found) return apiError('not_found', 'User not found', 404)
    const origin = apiOrigin(c.req.url, appUrl)
    const normalized = found.handle.toLowerCase()
    return jsonResponse({
      data: { handle: normalized, bio: found.bio, created_at: isoTimestamp(found.created_at),
        post_count: found.post_count, follower_count: found.follower_count, following_count: found.following_count,
        url: `${origin}/u/${encodeURIComponent(normalized)}`,
        api_url: `${origin}/api/v1/users/${encodeURIComponent(normalized)}` },
    })
  })

  app.get('/api/v1/users/:handle/posts', c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = resolveHandle(database, handle)
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/posts${new URL(c.req.url).search}`, 308)
    }
    return collection(c, database, { handle: resolved.handle }, appUrl)
  })

  app.get('/api/v1/tags/:tag/posts', c => {
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]+$/.test(tag)) return apiError('invalid_tag', 'Tag is invalid', 400)
    return collection(c, database, { tag }, appUrl)
  })

  app.get('/api/v1/firehose', c => {
    const ip = c.req.header('x-textlog-client-ip') || '-'
    const count = activeStreams.get(ip) || 0
    if (count >= SSE_LIMIT) return apiError('rate_limited', 'Too many firehose connections', 429, SSE_RETRY_AFTER)
    activeStreams.set(ip, count + 1)
    const encoder = new TextEncoder()
    let cleanup = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let unsubscribe = () => {}
        let heartbeat: ReturnType<typeof setInterval> | undefined
        const close = () => {
          if (closed) return
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          unsubscribe()
          const remaining = (activeStreams.get(ip) || 1) - 1
          if (remaining > 0) activeStreams.set(ip, remaining)
          else activeStreams.delete(ip)
          try {
            controller.close()
          }
          catch {}
        }
        const send = (value: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(value))
          }
          catch {
            close()
          }
        }
        unsubscribe = subscribeToPosts(postId => {
          try {
            const post = apiPost(database, postId, apiOrigin(c.req.url, appUrl))
            if (post) send(`id: ${post.id}\nevent: post\ndata: ${JSON.stringify(post)}\n\n`)
          }
          catch {
            cleanup()
          }
        })
        heartbeat = setInterval(() => send(': heartbeat\n\n'), SSE_HEARTBEAT_MS)
        cleanup = close
        c.req.raw.signal.addEventListener('abort', cleanup, { once: true })
        send('event: ready\ndata: {"status":"connected"}\n\n')
      },
      cancel() {
        cleanup()
      },
    })
    return new Response(stream, { headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    } })
  })

  app.all('/api/*', c => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const response = apiError('method_not_allowed', 'That endpoint does not accept this method', 405)
      response.headers.set('allow', 'GET, HEAD, OPTIONS')
      return response
    }
    return apiError('not_found', 'API endpoint not found', 404)
  })
}
