import type { Context, Hono } from 'hono'
import { API_DEFAULT_REPLY_DEPTH, API_MAX_REPLY_DEPTH, apiOrigin,
  parseCollectionParams } from '../api'
import { decodeActivityCursor } from '../api-activity'
import { subscribeToPosts } from '../api-broker'
import { appName, clientIpHeaderName } from '../brand'
import { ApiDocs, EmbedExamples } from '../components/pages'
import { isDevelopment } from '../environment'
import { decodeHotCursor } from '../hot'
import { logError } from '../log'
import { MAX_SEARCH_LENGTH, normalizeSearchQuery, searchExpression } from '../search'
import { apiUser, currentUser } from '../utils'
import { registerApiWriteRoutes } from './api-write'
import { page } from './shared'
import { registerSyndicationRoutes } from './syndication'
import { databaseService, type DatabaseService } from '../database-service'
import type { User } from '../types'

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

async function collection(c: Context, service: DatabaseService, filters: {
  excludeBots?: boolean
  handle?: string
  parentId?: number
  repliesOnly?: boolean
  tag?: string
  topLevelOnly?: boolean
} = {},
  appUrl?: string | null)
{
  const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
  if (!parsed) {
    return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
  }
  const result = await service.call('api.publicRead', {
    kind: 'collection', origin: apiOrigin(c.req.url, appUrl), ...parsed, ...filters,
  })
  return jsonResponse(result.status === 'ready' ? result.value : null)
}

function openApiDocument() {
  const quotedPostSchema = {
    type: 'object',
    required: ['id', 'top_id', 'body', 'created_at', 'parent_id', 'reply_count', 'tags', 'mentions', 'url', 'api_url',
      'author'],
    properties: {
      id: { type: 'integer' },
      top_id: { type: ['integer', 'null'],
        description: 'ID of the top-level post in this thread, or null when this post is already top-level.' },
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
  const postSchema = {
    ...quotedPostSchema,
    required: [...quotedPostSchema.required, 'parent'],
    properties: { ...quotedPostSchema.properties,
      parent: { anyOf: [{ $ref: '#/components/schemas/QuotedPost' }, { type: 'null' }],
        description: 'Immediate quoted parent, or null for a top-level or unavailable parent.' },
    },
  }
  const collectionParameters = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
  ]
  const jsonResponses = { '200': { description: 'Successful response' }, '400': { description: 'Invalid request' },
    '404': { description: 'Not found' }, '429': { description: 'Rate limited' } }
  const activityResponses = { ...jsonResponses, '200': { description: 'A typed activity collection', content: {
    'application/json': { schema: { type: 'object', required: ['data', 'has_unread', 'pagination'], properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Activity' } },
      has_unread: { type: 'boolean' },
      pagination: { type: 'object', required: ['next_cursor'], properties: {
        next_cursor: { type: ['string', 'null'] },
      } },
    } } },
  } } }
  const repliesResponse = { '200': { description: 'Replies up to the requested depth', content: {
    'application/json': { schema: {
      type: 'object',
      required: ['data', 'pagination'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/Reply' } },
        pagination: { type: 'object', required: ['next_cursor'], properties: {
          next_cursor: { type: ['string', 'null'] },
        } },
      },
    } },
  } }, '400': jsonResponses['400'], '404': jsonResponses['404'], '429': jsonResponses['429'] }
  const userResponse = { '200': { description: 'Public profile', content: {
    'application/json': { schema: { type: 'object', required: ['data'], properties: {
      data: { $ref: '#/components/schemas/User' },
    } } },
  } }, '400': jsonResponses['400'], '404': jsonResponses['404'], '429': jsonResponses['429'] }
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
    info: { title: `${appName()} public API`, version: '1.1.0',
      description: 'Public reads and authenticated writes for every account.' },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/feeds/latest': { get: { summary: 'Latest posts', parameters: collectionParameters, responses: jsonResponses } },
      '/activities/for-you': { get: { summary: 'Activity personalized for the authenticated account',
        parameters: collectionParameters, responses: { ...activityResponses, '401': writeResponses['401'] } } },
      '/activities/to-me': { get: { summary: 'Activity directed to the authenticated account',
        parameters: collectionParameters, responses: { ...activityResponses, '401': writeResponses['401'] } } },
      '/activities/for-you/read': { post: { summary: 'Mark selected for-you activities as read',
        responses: writeResponses } },
      '/activities/for-you/read-all': { post: { summary: 'Mark all for-you activities as read',
        responses: writeResponses } },
      '/activities/to-me/read': { post: { summary: 'Mark selected to-me activities as read',
        responses: writeResponses } },
      '/activities/to-me/read-all': { post: { summary: 'Mark all to-me activities as read',
        responses: writeResponses } },
      '/feeds/hot': { get: { summary: 'Hot posts', parameters: collectionParameters, responses: jsonResponses } },
      '/search': { get: { summary: 'Search public posts', security: [], parameters: [
        { name: 'q', in: 'query', required: true,
          schema: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_LENGTH } },
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
          description: `Returns replies recursively. The optional depth query parameter controls how many levels are
            returned (1–${API_MAX_REPLY_DEPTH}, default ${API_DEFAULT_REPLY_DEPTH}). Use each post's aggregate
            reply_count to determine whether descendants fall outside the response.`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            { name: 'depth', in: 'query', schema: { type: 'integer', minimum: 1, maximum: API_MAX_REPLY_DEPTH,
              default: API_DEFAULT_REPLY_DEPTH } },
            ...collectionParameters], responses: repliesResponse },
      },
      '/users/{handle}': {
        get: { summary: 'Public profile',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
          responses: userResponse },
      },
      '/users/{handle}/posts': {
        get: { summary: 'User\'s latest notes (alias)', deprecated: true,
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/users/{handle}/notes': {
        get: { summary: 'User\'s latest notes',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/users/{handle}/replies': {
        get: { summary: 'User\'s latest replies',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/users/{handle}/blocks': {
        get: { summary: 'Accounts blocked by the authenticated account', parameters: [handleParameter,
          ...collectionParameters], responses: { ...jsonResponses, '401': writeResponses['401'],
            '403': writeResponses['403'] } },
      },
      '/users/{handle}/following/users': { get: { summary: 'Accounts followed by a user',
        parameters: [handleParameter, ...collectionParameters], responses: jsonResponses } },
      '/users/{handle}/following/tags': { get: { summary: 'Hashtags followed by a user',
        parameters: [handleParameter, ...collectionParameters], responses: jsonResponses } },
      '/users/{handle}/followers': { get: { summary: 'Accounts following a user',
        parameters: [handleParameter, ...collectionParameters], responses: jsonResponses } },
      '/users/{handle}/posts.{format}': { get: { summary: 'User\'s latest posts as RSS or Atom', parameters: [
        { name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
        formatParameter,
      ], responses: syndicationResponses } },
      '/tags/{tag}/posts': {
        get: { summary: 'Posts with a hashtag',
          parameters: [{ name: 'tag', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: jsonResponses },
      },
      '/tags/{tag}': { get: { summary: 'Hashtag details', parameters: [
        { name: 'tag', in: 'path', required: true, schema: { type: 'string' } },
      ], responses: jsonResponses } },
      '/tags/{tag}/followers': { get: { summary: 'Accounts following a hashtag', parameters: [
        { name: 'tag', in: 'path', required: true, schema: { type: 'string' } }, ...collectionParameters,
      ], responses: jsonResponses } },
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
      schemas: { QuotedPost: quotedPostSchema, Post: postSchema, Activity: {
        type: 'object', required: ['id', 'type', 'created_at', 'unread', 'payload'], properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['post', 'reply', 'mention', 'user_follow', 'tag_follow', 'signup'] },
          created_at: { type: 'string', format: 'date-time' },
          unread: { type: 'boolean' },
          payload: { oneOf: [{ $ref: '#/components/schemas/Post' }, { type: 'object' }] },
        },
      }, Reply: {
        allOf: [
          { $ref: '#/components/schemas/Post' },
          { type: 'object', required: ['depth'], properties: {
            depth: { type: 'integer', minimum: 1,
              description: 'Distance from the post whose replies were requested.' },
          } },
        ],
      }, Tag: {
        type: 'object', required: ['tag', 'post_count', 'follower_count', 'url', 'api_url'], properties: {
          tag: { type: 'string' },
          post_count: { type: 'integer', minimum: 0 },
          follower_count: { type: 'integer', minimum: 0 },
          url: { type: 'string', format: 'uri' },
          api_url: { type: 'string', format: 'uri' },
        },
      }, User: {
        type: 'object',
        required: ['handle', 'bio', 'created_at', 'post_count', 'replies_count', 'follower_count',
          'following_user_count', 'following_tag_count', 'following_count', 'url', 'api_url'],
        properties: {
          handle: { type: 'string' },
          bio: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          post_count: { type: 'integer', minimum: 0, description: 'Number of top-level posts.' },
          replies_count: { type: 'integer', minimum: 0, description: 'Number of replies.' },
          follower_count: { type: 'integer', minimum: 0 },
          following_user_count: { type: 'integer', minimum: 0 },
          following_tag_count: { type: 'integer', minimum: 0 },
          following_count: { type: 'integer', minimum: 0,
            description: 'Backward-compatible alias for following_user_count.' },
          blocked_user_count: { type: 'integer', minimum: 0,
            description: 'Only returned when the authenticated account requests its own profile.' },
          blocked_tag_count: { type: 'integer', minimum: 0,
            description: 'Only returned when the authenticated account requests its own profile.' },
          url: { type: 'string', format: 'uri' },
          api_url: { type: 'string', format: 'uri' },
        },
      } },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  }
}

export function registerApiRoutes(app: Hono,
  appUrl: string | null | undefined = Bun.env.APP_URL, now: () => number = Date.now,
  configuredService?: DatabaseService, configuredApiUser?: (request: Request) => User | null)
{
  const service = configuredService || databaseService()
  const requestApiUser = configuredApiUser || ((request: Request) => apiUser(request))
  app.get('/api', c => page(<ApiDocs user={currentUser(c.req.raw)} />))
  app.get('/api/embed-examples', async c => {
    const sample = await service.call('api.embedExample', {})
    return page(
      <EmbedExamples user={currentUser(c.req.raw)} handle="stagas" tag={sample.tag} postId={sample.postId} />,
    )
  })

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
    const ip = c.req.header(clientIpHeaderName()) || '-'
    const limited = await service.call('system.consumeBucketedAttempt', {
      scope: 'api-json', identity: ip, attempts: JSON_LIMIT, bucketSeconds: JSON_WINDOW_SECONDS, now: now(),
    })
    if (limited) return apiError('rate_limited', 'Too many API requests', 429, limited.retryAfter)
    return next()
  })

  registerSyndicationRoutes(app, service, appUrl)
  registerApiWriteRoutes(app, service, requestApiUser, appUrl)

  app.get('/api/openapi.json', () => jsonResponse(openApiDocument(), 200, 'public, max-age=3600'))

  app.get('/api/v1/feeds/latest', c => collection(c, service, { excludeBots: true }, appUrl))

  for (const [path, kind] of [['for-you', 'personalizedFor'], ['to-me', 'toMeFor']] as const) {
    app.get(`/api/v1/activities/${path}`, async c => {
      const user = requestApiUser(c.req.raw)
      if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
      const parsed = parseCollectionParams(c.req.query('limit'))
      const cursorValue = c.req.query('cursor')
      const cursor = decodeActivityCursor(cursorValue)
      if (!parsed || (cursorValue && !cursor)) {
        return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
      }
      return jsonResponse(await service.call('api.activities', { user, origin: apiOrigin(c.req.url, appUrl),
        limit: parsed.limit, cursor, toMe: kind === 'toMeFor' }))
    })
    app.post(`/api/v1/activities/${path}/read`, async c => {
      const user = requestApiUser(c.req.raw)
      if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
      let payload: unknown
      try {
        payload = await c.req.json()
      }
      catch {
        return apiError('invalid_body', 'Provide activity_ids as an array of activity IDs', 400)
      }
      const activityIds = (payload as { activity_ids?: unknown })?.activity_ids
      if (!Array.isArray(activityIds) || activityIds.length < 1 || activityIds.length > 100
        || activityIds.some(id => typeof id !== 'string' || !id || id.length > 500)) {
        return apiError('invalid_body', 'Provide 1–100 activity_ids from this feed', 400)
      }
      const read = await service.call('api.markActivitiesRead', {
        userId: user.id, activityIds: [...new Set(activityIds)], toMe: kind === 'toMeFor',
      })
      return jsonResponse({ data: { read } }, 200, 'no-store')
    })
    app.post(`/api/v1/activities/${path}/read-all`, async c => {
      const user = requestApiUser(c.req.raw)
      if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
      await service.call('api.markAllActivitiesRead', { userId: user.id, toMe: kind === 'toMeFor' })
      return jsonResponse({ data: { read_all: true } }, 200, 'no-store')
    })
  }

  app.get('/api/v1/search', async c => {
    const rawQuery = c.req.query('q') || ''
    const query = normalizeSearchQuery(rawQuery)
    if (!query || rawQuery.trim().length > MAX_SEARCH_LENGTH || !searchExpression(query)) {
      return apiError('invalid_query', `q must contain searchable text up to ${MAX_SEARCH_LENGTH} characters`, 400)
    }
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const result = await service.call('api.publicRead', { kind: 'search',
      origin: apiOrigin(c.req.url, appUrl), query, limit: parsed.limit, offset: parsed.before || 0 })
    return jsonResponse(result.status === 'ready' ? result.value : null)
  })

  app.get('/api/v1/feeds/hot', async c => {
    const parsed = parseCollectionParams(c.req.query('limit'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodeHotCursor(cursorValue)
    if (cursorValue && !cursor) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const result = await service.call('api.publicRead', { kind: 'hot',
      origin: apiOrigin(c.req.url, appUrl), limit: parsed.limit, cursor })
    return jsonResponse(result.status === 'ready' ? result.value : null)
  })

  app.get('/api/v1/posts/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return apiError('invalid_post_id', 'Post ID must be a positive integer', 400)
    const result = await service.call('api.publicRead', {
      kind: 'post', origin: apiOrigin(c.req.url, appUrl), id,
    })
    return result.status === 'ready' ? jsonResponse(result.value) : apiError('not_found', 'Post not found', 404)
  })

  app.get('/api/v1/posts/:id/replies', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return apiError('invalid_post_id', 'Post ID must be a positive integer', 400)
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const depthValue = c.req.query('depth')
    const depth = depthValue === undefined ? API_DEFAULT_REPLY_DEPTH : Number(depthValue)
    if (!Number.isInteger(depth) || depth < 1 || depth > API_MAX_REPLY_DEPTH) {
      return apiError('invalid_depth', `depth must be an integer from 1 to ${API_MAX_REPLY_DEPTH}`, 400)
    }
    const result = await service.call('api.publicRead', { kind: 'replies',
      origin: apiOrigin(c.req.url, appUrl), id, limit: parsed.limit, before: parsed.before, depth })
    return result.status === 'ready' ? jsonResponse(result.value) : apiError('not_found', 'Post not found', 404)
  })

  app.get('/api/v1/users/:handle', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const origin = apiOrigin(c.req.url, appUrl)
    const result = await service.call('api.profile', {
      handle, viewerId: requestApiUser(c.req.raw)?.id ?? null, origin,
    })
    if (result.status === 'not_found') return apiError('not_found', 'User not found', 404)
    if (result.status === 'redirect') return c.redirect(`/api/v1/users/${encodeURIComponent(result.handle)}`, 308)
    return jsonResponse(result.value, 200, result.private ? 'no-store' : undefined)
  })

  app.get('/api/v1/users/:handle/posts', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = await service.call('profiles.resolve', { handle })
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/posts${new URL(c.req.url).search}`, 308)
    }
    return collection(c, service, { handle: resolved.handle, topLevelOnly: true }, appUrl)
  })

  app.get('/api/v1/users/:handle/notes', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = await service.call('profiles.resolve', { handle })
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/notes${new URL(c.req.url).search}`, 308)
    }
    return collection(c, service, { handle: resolved.handle, topLevelOnly: true }, appUrl)
  })

  app.get('/api/v1/users/:handle/replies', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = await service.call('profiles.resolve', { handle })
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/replies${new URL(c.req.url).search}`, 308)
    }
    return collection(c, service, { handle: resolved.handle, repliesOnly: true }, appUrl)
  })

  app.get('/api/v1/users/:handle/blocks', async c => {
    const user = requestApiUser(c.req.raw)
    if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const origin = apiOrigin(c.req.url, appUrl)
    const result = await service.call('api.relationships', { kind: 'blocks', handle, viewerId: user.id, origin,
      limit: parsed.limit, before: parsed.before })
    if (result.status === 'not_found') return apiError('not_found', 'User not found', 404)
    if (result.status === 'forbidden') {
      return apiError('forbidden', 'You can only list your own blocked accounts', 403)
    }
    if (result.status === 'redirect') {
      return c.redirect(`/api/v1/users/${encodeURIComponent(result.handle)}/blocks${new URL(c.req.url).search}`, 308)
    }
    return jsonResponse(result.value, 200, 'no-store')
  })

  for (const relationship of ['following/users', 'followers'] as const) {
    app.get(`/api/v1/users/:handle/${relationship}`, async c => {
      const handle = c.req.param('handle')
      if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
      const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
      if (!parsed) {
        return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
      }
      const result = await service.call('api.relationships', {
        kind: relationship === 'following/users' ? 'following' : 'followers', handle,
        origin: apiOrigin(c.req.url, appUrl), limit: parsed.limit, before: parsed.before,
      })
      if (result.status === 'not_found') return apiError('not_found', 'User not found', 404)
      if (result.status === 'redirect') {
        return c.redirect(`/api/v1/users/${encodeURIComponent(result.handle)}/${relationship}${new URL(c.req.url).search}`,
          308)
      }
      if (result.status === 'forbidden') return apiError('forbidden', 'Forbidden', 403)
      return jsonResponse(result.value)
    })
  }

  app.get('/api/v1/users/:handle/following/tags', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) return apiError('invalid_pagination', 'limit and cursor are invalid', 400)
    const origin = apiOrigin(c.req.url, appUrl)
    const result = await service.call('api.relationships', {
      kind: 'followingTags', handle, origin, limit: parsed.limit, before: parsed.before,
    })
    if (result.status === 'not_found') return apiError('not_found', 'User not found', 404)
    if (result.status === 'redirect') {
      return c.redirect(`/api/v1/users/${encodeURIComponent(result.handle)}/following/tags${new URL(c.req.url).search}`,
        308)
    }
    if (result.status === 'forbidden') return apiError('forbidden', 'Forbidden', 403)
    return jsonResponse(result.value)
  })

  app.get('/api/v1/tags/:tag', async c => {
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]+$/.test(tag)) return apiError('invalid_tag', 'Tag is invalid', 400)
    const origin = apiOrigin(c.req.url, appUrl)
    const result = await service.call('api.tagDetails', { tag, origin })
    return result.status === 'ready' ? jsonResponse(result.value) : apiError('not_found', 'Tag not found', 404)
  })

  app.get('/api/v1/tags/:tag/followers', async c => {
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]+$/.test(tag)) return apiError('invalid_tag', 'Tag is invalid', 400)
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) return apiError('invalid_pagination', 'limit and cursor are invalid', 400)
    const result = await service.call('api.relationships', { kind: 'tagFollowers', tag,
      origin: apiOrigin(c.req.url, appUrl), limit: parsed.limit, before: parsed.before })
    return result.status === 'ready' ? jsonResponse(result.value) : apiError('not_found', 'Tag not found', 404)
  })

  app.get('/api/v1/tags/:tag/posts', c => {
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]+$/.test(tag)) return apiError('invalid_tag', 'Tag is invalid', 400)
    return collection(c, service, { tag }, appUrl)
  })

  app.get('/api/v1/firehose', c => {
    const ip = c.req.header(clientIpHeaderName()) || '-'
    const count = activeStreams.get(ip) || 0
    if (!isDevelopment() && count >= SSE_LIMIT) {
      return apiError('rate_limited', 'Too many firehose connections', 429, SSE_RETRY_AFTER)
    }
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
          void service.call('api.publicRead', { kind: 'post', origin: apiOrigin(c.req.url, appUrl), id: postId })
            .then(result => {
              if (result.status !== 'ready') return
              const post = (result.value as { data: { id: number } }).data
              send(`id: ${post.id}\nevent: post\ndata: ${JSON.stringify(post)}\n\n`)
            })
            .catch(() => cleanup())
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
