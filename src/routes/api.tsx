import type { Context, Hono, MiddlewareHandler } from 'hono'
import { API_DEFAULT_REPLY_DEPTH, API_MAX_REPLY_DEPTH, apiOrigin, encodeCursor, parseCollectionParams } from '../api'
import { decodeActivityCursor } from '../api-activity'
import { subscribeToPosts } from '../api-broker'
import { appName, clientIpHeaderName } from '../brand'
import { BIO_MAX } from '../bio-body'
import { ApiDocs, EmbedExamples } from '../components/pages'
import { type DatabaseService, databaseService } from '../database-service'
import { decodeHotCursor } from '../hot'
import { logError } from '../log'
import { POST_MAX } from '../post-body'
import { PAGE_SIZE_CHOICES, type PageSizeChoice } from '../request-preferences'
import { MAX_SEARCH_LENGTH, normalizeSearchQuery, searchExpression } from '../search'
import type { User } from '../types'
import { apiUser, currentUser } from '../utils'
import { registerApiWriteRoutes } from './api-write'
import { page } from './shared'
import { registerSyndicationRoutes } from './syndication'

const JSON_LIMIT = 120
const AUTHENTICATED_JSON_LIMIT = 600
const JSON_WINDOW_SECONDS = 60
const SSE_HEARTBEAT_MS = 5_000

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
  handle?: string
  parentId?: number
  repliesOnly?: boolean
  tag?: string
  topLevelOnly?: boolean
} = {}, appUrl?: string | null, viewerId?: number) {
  const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
  if (!parsed) {
    return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
  }
  const result = await service.call('api.publicRead', {
    kind: 'collection',
    origin: apiOrigin(c.req.url, appUrl),
    ...parsed,
    ...filters,
    viewerId,
  })
  return jsonResponse(result.status === 'ready' ? result.value : null)
}

function openApiDocument() {
  const quotedPostSchema = {
    type: 'object',
    required: ['id', 'top_id', 'body', 'created_at', 'parent_id', 'reply_count', 'tags', 'mentions', 'link_previews',
      'location', 'poll', 'url', 'api_url', 'author'],
    properties: {
      id: { type: 'integer' },
      top_id: { type: ['integer', 'null'],
        description: 'ID of the top-level post in this thread, or null when this post is already top-level.' },
      body: { type: 'string', maxLength: POST_MAX },
      created_at: { type: 'string', format: 'date-time' },
      parent_id: { type: ['integer', 'null'] },
      reply_count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      mentions: { type: 'array', items: { type: 'string' } },
      link_previews: { type: 'object', additionalProperties: { $ref: '#/components/schemas/LinkPreview' } },
      location: { anyOf: [{ type: 'object', required: ['query', 'latitude', 'longitude', 'displayName', 'url',
        'preview'], properties: {
        query: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' },
        displayName: { type: 'string' }, url: { type: 'string', format: 'uri' },
        preview: { $ref: '#/components/schemas/LinkPreview' },
      } }, { type: 'null' }] },
      poll: { anyOf: [{ $ref: '#/components/schemas/Poll' }, { type: 'null' }] },
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
        description: 'Immediate quoted parent, or null for a top-level or unavailable parent.' } },
  }
  const collectionParameters = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
  ]
  const threadedFeedParameters = [
    { name: 'limit', in: 'query', schema: { type: 'integer', enum: [...PAGE_SIZE_CHOICES], default: 20 },
      description: 'Conversations per page; matches a supported web feed page size.' },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
  ]
  const authSecurity = [{ bearerAuth: [] }]
  const optionalAuthSecurity = [{}, { bearerAuth: [] }]
  const errorResponse = (description: string) => ({ description, content: { 'application/json': {
    schema: { $ref: '#/components/schemas/Error' },
  } } })
  const jsonResponses = { '200': { description: 'Successful response' }, '400': errorResponse('Invalid request'),
    '404': errorResponse('Not found'), '429': errorResponse('Rate limited') }
  const requestBody = (schema: unknown, required = true) => ({ required, content: {
    'application/json': { schema },
  } })
  const dataResponse = (schema: unknown, description = 'Successful response') => ({ description, content: {
    'application/json': { schema: { type: 'object', required: ['data'], properties: { data: schema } } },
  } })
  const collectionResponse = { description: 'Paginated post collection', content: { 'application/json': { schema: {
    $ref: '#/components/schemas/PostCollection',
  } } } }
  const threadedFeedResponse = { description: 'A conversation-paginated feed matching the web application',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ThreadedFeed' } } } }
  const postResponse = dataResponse({ $ref: '#/components/schemas/Post' })
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
  const draftIdParameter = { name: 'id', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' } }
  const handleParameter = { name: 'handle', in: 'path', required: true, schema: { type: 'string' } }
  const tagParameter = { name: 'tag', in: 'path', required: true,
    schema: { type: 'string', pattern: '^[a-zA-Z0-9_]+$' } }
  const writeResponses = { ...jsonResponses, '401': errorResponse('Missing or invalid token'),
    '403': errorResponse('The authenticated account cannot perform this operation') }
  const syndicationResponses = { '200': { description: 'RSS 2.0 or Atom 1.0 XML feed', content: {
    'application/rss+xml': { schema: { type: 'string' } },
    'application/atom+xml': { schema: { type: 'string' } },
  } }, '404': { description: 'Not found' }, '429': { description: 'Rate limited' } }
  return {
    openapi: '3.1.0',
    info: { title: `${appName()} public API`, version: '1.5.0',
      description: 'Public reads and authenticated writes for every account.' },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/feeds/all': {
        get: { summary: 'All posts', security: optionalAuthSecurity,
          description: 'Bearer authentication is optional. Authenticated responses add unread state to each post and '
            + 'include has_unread and unread_count.', parameters: collectionParameters,
          responses: { ...jsonResponses, '200': collectionResponse },
          'x-root-aliases': ['/all.json'], 'x-backward-compatible-aliases': ['/feeds/latest', '/latest.json'] },
      },
      '/feeds/all/read': {
        'x-backward-compatible-aliases': ['/feeds/latest/read'],
        post: { summary: 'Mark selected all-feed posts as read', security: authSecurity,
          requestBody: requestBody({ type: 'object', required: ['post_ids'], properties: {
            post_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true,
              items: { type: 'integer', minimum: 1 } },
          } }), responses: { ...writeResponses, '200': dataResponse({ type: 'object', required: ['read'], properties: {
            read: { type: 'integer', minimum: 0 },
          } }) } },
      },
      '/feeds/all/read-all': {
        'x-backward-compatible-aliases': ['/feeds/latest/read-all'],
        post: { summary: 'Mark every visible all-feed post as read', security: authSecurity,
          responses: { ...writeResponses,
            '200': dataResponse({ type: 'object', required: ['read_all', 'read'],
              properties: { read_all: { type: 'boolean' }, read: { type: 'integer', minimum: 0 } } }) } },
      },
      '/activities/my-feed': {
        'x-backward-compatible-aliases': ['/activities/for-you'],
        get: { summary: 'Activity personalized for the authenticated account', security: authSecurity,
          parameters: collectionParameters, responses: { ...activityResponses, '401': writeResponses['401'] } },
      },
      '/activities/@': {
        'x-backward-compatible-aliases': ['/activities/to-me'],
        get: { summary: 'Activity directed to the authenticated account', security: authSecurity,
          parameters: collectionParameters, responses: { ...activityResponses, '401': writeResponses['401'] } },
      },
      '/activities/my-feed/conversations': {
        'x-backward-compatible-aliases': ['/activities/for-you/conversations'],
        get: { summary: 'My Feed activity grouped like the web feed', security: authSecurity,
          parameters: threadedFeedParameters,
          responses: { ...activityResponses, '200': { description: 'A web-compatible threaded activity feed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ThreadedActivityFeed' } } } } } },
      },
      '/activities/@/conversations': {
        'x-backward-compatible-aliases': ['/activities/to-me/conversations'],
        get: { summary: '@ activity grouped like the web feed', security: authSecurity,
          parameters: threadedFeedParameters,
          responses: { ...activityResponses, '200': { description: 'A web-compatible threaded activity feed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ThreadedActivityFeed' } } } } } },
      },
      '/activities/my-feed/read': {
        'x-backward-compatible-aliases': ['/activities/for-you/read'],
        post: { summary: 'Mark selected My Feed activities as read', security: authSecurity,
          requestBody: requestBody({ $ref: '#/components/schemas/ActivityReadRequest' }), responses: writeResponses },
      },
      '/activities/my-feed/read-all': {
        'x-backward-compatible-aliases': ['/activities/for-you/read-all'],
        post: { summary: 'Mark all My Feed activities as read', security: authSecurity, responses: writeResponses },
      },
      '/activities/@/read': {
        'x-backward-compatible-aliases': ['/activities/to-me/read'],
        post: { summary: 'Mark selected @ activities as read', security: authSecurity,
          requestBody: requestBody({ $ref: '#/components/schemas/ActivityReadRequest' }), responses: writeResponses },
      },
      '/activities/@/read-all': {
        'x-backward-compatible-aliases': ['/activities/to-me/read-all'],
        post: { summary: 'Mark all @ activities as read', security: authSecurity, responses: writeResponses },
      },
      '/feeds/hot': {
        get: { summary: 'Hot posts', security: optionalAuthSecurity, parameters: collectionParameters,
          responses: { ...jsonResponses, '200': collectionResponse }, 'x-root-aliases': ['/hot.json'] },
      },
      '/feeds/all/conversations': {
        'x-backward-compatible-aliases': ['/feeds/latest/conversations'],
        get: { summary: 'All feed grouped into web conversations', security: optionalAuthSecurity,
          parameters: threadedFeedParameters, responses: { ...jsonResponses, '200': threadedFeedResponse } },
      },
      '/feeds/hot/conversations': {
        get: { summary: 'Hot feed grouped into web conversations', security: optionalAuthSecurity,
          parameters: threadedFeedParameters, responses: { ...jsonResponses, '200': threadedFeedResponse } },
      },
      '/search': { get: { summary: 'Search public posts', security: optionalAuthSecurity, parameters: [
        { name: 'q', in: 'query', required: true,
          schema: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_LENGTH } },
        ...collectionParameters,
      ], responses: { ...jsonResponses, '200': collectionResponse } } },
      '/bookmarks': { get: { summary: 'List and search your bookmarks', security: authSecurity, parameters: [
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: MAX_SEARCH_LENGTH } },
        ...collectionParameters,
      ], responses: { ...jsonResponses, '200': collectionResponse, '401': writeResponses['401'] } } },
      '/autotags': {
        post: { summary: 'Enrich text with hashtags', security: authSecurity,
          description: 'Returns the complete text enriched with relevant hashtags. It does not save a post.',
          requestBody: requestBody({ type: 'object', required: ['body'], properties: {
            body: { type: 'string', minLength: 1, maxLength: POST_MAX },
          } }),
          responses: { ...writeResponses, '200': dataResponse({ type: 'object', required: ['body'], properties: {
            body: { type: 'string', minLength: 1, maxLength: POST_MAX },
          } }), '422': errorResponse('The autotagged text exceeds the post limits'),
            '503': errorResponse('Autotags are unavailable') } },
      },
      '/feeds/all.{format}': {
        get: { summary: 'All posts as RSS or Atom', parameters: [formatParameter], responses: syndicationResponses,
          'x-root-aliases': ['/all.rss', '/all.atom'],
          'x-backward-compatible-aliases': ['/feeds/latest.{format}', '/latest.rss', '/latest.atom'] },
      },
      '/feeds/hot.{format}': {
        get: { summary: 'Hot posts as RSS or Atom', parameters: [formatParameter], responses: syndicationResponses,
          'x-root-aliases': ['/hot.rss', '/hot.atom'] },
      },
      '/posts/{id}': {
        get: { summary: 'Single post', security: optionalAuthSecurity, parameters: [postIdParameter],
          responses: { ...jsonResponses, '200': postResponse } },
        patch: { summary: 'Edit your own post', security: authSecurity, parameters: [postIdParameter],
          requestBody: requestBody({ $ref: '#/components/schemas/PostWriteRequest' }),
          responses: { ...writeResponses, '200': postResponse } },
        delete: { summary: 'Delete your own post', security: authSecurity, parameters: [postIdParameter],
          responses: writeResponses },
      },
      '/posts/{id}/replies': {
        get: { summary: 'Post replies', security: optionalAuthSecurity,
          description: `Returns replies recursively. The optional depth query parameter controls how many levels are
            returned (1–${API_MAX_REPLY_DEPTH}, default ${API_DEFAULT_REPLY_DEPTH}). Use each post's aggregate
            reply_count to determine whether descendants fall outside the response.`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }, {
            name: 'depth',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: API_MAX_REPLY_DEPTH, default: API_DEFAULT_REPLY_DEPTH },
          }, ...collectionParameters], responses: repliesResponse },
      },
      '/users/{handle}': {
        get: { summary: 'Public profile',
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } }],
          security: optionalAuthSecurity, responses: userResponse },
      },
      '/users/{handle}/posts': {
        get: { summary: 'User\'s latest notes (alias)', deprecated: true, security: optionalAuthSecurity,
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: { ...jsonResponses, '200': collectionResponse } },
      },
      '/users/{handle}/notes': {
        get: { summary: 'User\'s latest notes', security: optionalAuthSecurity,
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: { ...jsonResponses, '200': collectionResponse } },
      },
      '/users/{handle}/replies': {
        get: { summary: 'User\'s latest replies', security: optionalAuthSecurity,
          parameters: [{ name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
            ...collectionParameters], responses: { ...jsonResponses, '200': collectionResponse } },
      },
      '/users/{handle}/blocks': {
        get: { summary: 'Accounts blocked by the authenticated account', security: authSecurity,
          parameters: [handleParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': { description: 'Paginated blocked accounts', content: {
            'application/json': { schema: { $ref: '#/components/schemas/UserReferenceCollection' } },
          } }, '401': writeResponses['401'], '403': writeResponses['403'] } },
      },
      '/users/{handle}/following/users': {
        get: { summary: 'Accounts followed by a user', parameters: [handleParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': { description: 'Paginated accounts', content: { 'application/json': {
            schema: { $ref: '#/components/schemas/UserReferenceCollection' },
          } } } } },
      },
      '/users/{handle}/following/tags': {
        get: { summary: 'Hashtags followed by a user', parameters: [handleParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': { description: 'Paginated hashtags', content: { 'application/json': {
            schema: { $ref: '#/components/schemas/TagCollection' },
          } } } } },
      },
      '/users/{handle}/followers': {
        get: { summary: 'Accounts following a user', parameters: [handleParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': { description: 'Paginated accounts', content: { 'application/json': {
            schema: { $ref: '#/components/schemas/UserReferenceCollection' },
          } } } } },
      },
      '/users/{handle}/posts.{format}': { get: { summary: 'User\'s latest posts as RSS or Atom', parameters: [
        { name: 'handle', in: 'path', required: true, schema: { type: 'string' } },
        formatParameter,
      ], responses: syndicationResponses } },
      '/tags/{tag}/posts': {
        get: { summary: 'Posts with a hashtag', security: optionalAuthSecurity,
          parameters: [tagParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': collectionResponse } },
      },
      '/tags/{tag}': {
        get: { summary: 'Hashtag details', security: optionalAuthSecurity, parameters: [tagParameter],
          responses: { ...jsonResponses, '200': dataResponse({
            $ref: '#/components/schemas/Tag',
          }) } },
      },
      '/tags/{tag}/followers': {
        get: { summary: 'Accounts following a hashtag', parameters: [tagParameter, ...collectionParameters],
          responses: { ...jsonResponses, '200': { description: 'Paginated accounts', content: {
            'application/json': { schema: { $ref: '#/components/schemas/UserReferenceCollection' } },
          } } } },
      },
      '/tags/{tag}/posts.{format}': { get: { summary: 'Hashtag posts as RSS or Atom', parameters: [
        { name: 'tag', in: 'path', required: true, schema: { type: 'string' } },
        formatParameter,
      ], responses: syndicationResponses } },
      '/firehose': {
        get: { summary: 'Live post stream', security: [], responses: {
          '200': { description: 'Server-sent events',
            content: { 'text/event-stream': { schema: { type: 'string' } } } },
        } },
      },
      '/auth/request': {
        post: { summary: 'Email a sign-in code to an existing account', security: [],
          requestBody: requestBody({ type: 'object', required: ['email'], properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
          } }), responses: writeResponses },
      },
      '/auth/verify': {
        post: { summary: 'Exchange a sign-in code for a session token', security: [],
          requestBody: requestBody({ type: 'object', required: ['email', 'code'], properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            code: { type: 'string', pattern: '^\\d{6}$' },
          } }), responses: writeResponses },
      },
      '/auth/session': {
        delete: { summary: 'Revoke the current token', security: authSecurity, responses: writeResponses },
      },
      '/me': {
        get: { summary: 'The signed-in account', security: authSecurity,
          responses: { ...writeResponses, '200': dataResponse({ $ref: '#/components/schemas/Account' }) } },
        patch: { summary: 'Update your bio', security: authSecurity,
          requestBody: requestBody({ type: 'object', required: ['bio'], properties: {
            bio: { type: 'string', maxLength: BIO_MAX },
          } }), responses: { ...writeResponses, '200': dataResponse({ $ref: '#/components/schemas/Account' }) } },
      },
      '/posts': {
        post: { summary: 'Create a post or reply', security: authSecurity,
          requestBody: requestBody({ $ref: '#/components/schemas/PostCreateRequest' }),
          responses: { ...writeResponses, '200': postResponse, '201': postResponse } },
      },
      '/posts/{id}/report': {
        post: { summary: 'Report a post', security: authSecurity, parameters: [postIdParameter],
          requestBody: requestBody({ type: 'object', required: ['reason'], properties: {
            reason: { type: 'string', enum: ['harassment', 'spam', 'impersonation', 'bot', 'other'] },
          } }), responses: writeResponses },
      },
      '/posts/{id}/bookmark': {
        post: { summary: 'Bookmark a post', security: authSecurity, parameters: [postIdParameter],
          responses: writeResponses },
        delete: { summary: 'Remove a post bookmark', security: authSecurity, parameters: [postIdParameter],
          responses: writeResponses },
      },
      '/posts/{id}/poll/votes': {
        post: { summary: 'Vote in a poll', security: authSecurity, parameters: [postIdParameter],
          requestBody: requestBody({ type: 'object', required: ['option_id'], properties: {
            option_id: { type: 'integer', minimum: 1 },
          } }),
          responses: { ...writeResponses, '201': postResponse,
            '409': errorResponse('The poll expired or the account already voted') } },
      },
      '/posts/{id}/unpublish': {
        post: { summary: 'Move a post you own back to drafts', security: authSecurity, parameters: [postIdParameter],
          responses: { ...writeResponses, '201': dataResponse({ $ref: '#/components/schemas/Draft' }) } },
      },
      '/drafts': {
        get: { summary: 'List your drafts', security: authSecurity, parameters: collectionParameters,
          responses: { ...writeResponses, '200': { description: 'Paginated drafts', content: { 'application/json': {
            schema: { $ref: '#/components/schemas/DraftCollection' },
          } } } } },
        post: { summary: 'Create a draft', security: authSecurity,
          requestBody: requestBody({ $ref: '#/components/schemas/PostCreateRequest' }),
          responses: { ...writeResponses, '201': dataResponse({ $ref: '#/components/schemas/Draft' }) } },
      },
      '/drafts/{id}': {
        get: { summary: 'Get one of your drafts', security: authSecurity, parameters: [draftIdParameter],
          responses: { ...writeResponses, '200': dataResponse({ $ref: '#/components/schemas/Draft' }) } },
        patch: { summary: 'Update one of your drafts', security: authSecurity, parameters: [draftIdParameter],
          requestBody: requestBody({ $ref: '#/components/schemas/DraftUpdateRequest' }),
          responses: { ...writeResponses, '200': dataResponse({ $ref: '#/components/schemas/Draft' }) } },
        delete: { summary: 'Delete one of your drafts', security: authSecurity, parameters: [draftIdParameter],
          responses: writeResponses },
      },
      '/drafts/{id}/publish': {
        post: { summary: 'Atomically publish a draft', security: authSecurity, parameters: [draftIdParameter],
          responses: { ...writeResponses, '200': postResponse, '201': postResponse } },
      },
      '/explore': {
        get: { summary: 'Discover people and trending hashtags', security: optionalAuthSecurity, parameters: [
          { name: 'people_limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'people_cursor', in: 'query', schema: { type: 'string' } },
          { name: 'tags_limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'tags_cursor', in: 'query', schema: { type: 'string' } },
        ], responses: { ...jsonResponses, '200': { description: 'People and hashtag suggestions', content: {
          'application/json': { schema: { $ref: '#/components/schemas/ExploreResponse' } },
        } } } },
      },
      '/tags/{tag}/follow': {
        post: { summary: 'Follow a hashtag', security: authSecurity, parameters: [tagParameter],
          responses: writeResponses },
        delete: { summary: 'Unfollow a hashtag', security: authSecurity, parameters: [tagParameter],
          responses: writeResponses },
      },
      '/tags/{tag}/block': {
        post: { summary: 'Block a hashtag', security: authSecurity, parameters: [tagParameter],
          responses: writeResponses },
        delete: { summary: 'Unblock a hashtag', security: authSecurity, parameters: [tagParameter],
          responses: writeResponses },
      },
      '/users/{handle}/follow': {
        post: { summary: 'Follow a user', security: authSecurity, parameters: [handleParameter],
          responses: writeResponses },
        delete: { summary: 'Unfollow a user', security: authSecurity, parameters: [handleParameter],
          responses: writeResponses },
      },
      '/users/{handle}/block': {
        post: { summary: 'Block a user', security: authSecurity, parameters: [handleParameter],
          responses: writeResponses },
        delete: { summary: 'Unblock a user', security: authSecurity, parameters: [handleParameter],
          responses: writeResponses },
      },
    },
    security: [],
    components: {
      schemas: { Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'object', required: ['code', 'message'],
            properties: { code: { type: 'string' }, message: { type: 'string' } } },
        },
      }, Pagination: {
        type: 'object',
        required: ['next_cursor'],
        properties: { next_cursor: { type: ['string', 'null'] } },
      }, UserReference: {
        type: 'object',
        required: ['handle', 'url', 'api_url'],
        properties: { handle: { type: 'string' }, url: { type: 'string', format: 'uri' },
          api_url: { type: 'string', format: 'uri' } },
      }, UserReferenceCollection: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/UserReference' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      }, TagCollection: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      }, Account: {
        type: 'object',
        required: ['handle', 'email', 'bio', 'email_verified', 'can_post'],
        properties: {
          handle: { type: 'string' },
          email: { type: 'string', format: 'email' },
          bio: { type: 'string' },
          email_verified: { type: 'boolean' },
          can_post: { type: 'boolean' },
        },
      }, PostCollection: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: {
            allOf: [{ $ref: '#/components/schemas/Post' }, { type: 'object', properties: {
              unread: { type: 'boolean', description: 'Present on authenticated latest-feed reads.' },
            } }],
          } },
          pagination: { $ref: '#/components/schemas/Pagination' },
          has_unread: { type: 'boolean', description: 'Present on authenticated latest-feed reads.' },
          unread_count: { type: 'integer', minimum: 0, description: 'Present on authenticated latest-feed reads.' },
        },
      }, ThreadedFeedPost: {
        allOf: [{ $ref: '#/components/schemas/Post' }, { type: 'object',
          required: ['classification', 'depth', 'feed_ancestor_gap', 'unread', 'directed_to_viewer'], properties: {
            classification: { type: 'string', enum: ['root', 'reply'] },
            depth: { type: 'integer', minimum: 0, description: 'Absolute depth beneath the conversation root.' },
            feed_ancestor_gap: { type: 'boolean',
              description: 'True when unavailable ancestors were skipped by the web feed.' },
            unread: { type: 'boolean', description: 'Whether this latest-feed post is unread for the viewer.' },
            directed_to_viewer: { type: 'boolean',
              description: 'Whether this unread latest-feed post is directed to the viewer.' },
          } }],
      }, ThreadedConversation: {
        type: 'object', required: ['id', 'posts'], properties: {
          id: { type: 'integer', description: 'Canonical top-level conversation post ID.' },
          posts: { type: 'array', items: { $ref: '#/components/schemas/ThreadedFeedPost' } },
        },
      }, ThreadedFeed: {
        type: 'object', required: ['data', 'pagination'], properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/ThreadedConversation' } },
          pagination: { type: 'object', required: ['next_cursor', 'previous_cursor'], properties: {
            next_cursor: { type: ['string', 'null'] }, previous_cursor: { type: ['string', 'null'] },
          } },
        },
      }, ThreadedActivityFeed: {
        type: 'object', required: ['data', 'has_unread', 'pagination'], properties: {
          data: { type: 'array', items: { oneOf: [
            { type: 'object', required: ['type', 'conversation'], properties: {
              type: { const: 'conversation' }, conversation: { $ref: '#/components/schemas/ThreadedConversation' },
            } },
            { type: 'object', required: ['type', 'activity'], properties: {
              type: { const: 'activity' }, activity: { $ref: '#/components/schemas/Activity' },
            } },
          ] } },
          has_unread: { type: 'boolean' },
          pagination: { type: 'object', required: ['next_cursor', 'previous_cursor'], properties: {
            next_cursor: { type: ['string', 'null'] }, previous_cursor: { type: ['string', 'null'] },
          } },
        },
      }, ActivityReadRequest: {
        type: 'object',
        required: ['activity_ids'],
        properties: {
          activity_ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 500 } },
        },
      }, PostWriteRequest: {
        type: 'object',
        required: ['body'],
        additionalProperties: false,
        properties: {
          body: { type: 'string', minLength: 1, maxLength: POST_MAX },
        },
      }, PostCreateRequest: {
        type: 'object',
        required: ['body'],
        additionalProperties: false,
        properties: {
          body: { type: 'string', minLength: 1, maxLength: POST_MAX },
          parent_id: { type: ['integer', 'null'], minimum: 1 },
        },
      }, DraftUpdateRequest: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          body: { type: 'string', minLength: 1, maxLength: POST_MAX },
          parent_id: { type: ['integer', 'null'], minimum: 1 },
        },
      }, Draft: {
        type: 'object',
        required: ['id', 'body', 'parent_id', 'created_at', 'updated_at', 'parent'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          body: { type: 'string' },
          parent_id: { type: ['integer', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          parent: { anyOf: [{ $ref: '#/components/schemas/Post' }, { type: 'null' }] },
        },
      }, DraftCollection: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Draft' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      }, ExplorePerson: {
        type: 'object',
        required: ['handle', 'bio', 'post_count', 'following', 'follows_viewer', 'url', 'api_url'],
        properties: { handle: { type: 'string' }, bio: { type: 'string' }, post_count: { type: 'integer' },
          following: { type: 'boolean' }, follows_viewer: { type: 'boolean' }, url: { type: 'string', format: 'uri' },
          api_url: { type: 'string', format: 'uri' } },
      }, ExploreTag: {
        allOf: [{ $ref: '#/components/schemas/Tag' }],
      }, ExploreResponse: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'object', required: ['people', 'tags'], properties: {
            people: { type: 'array', items: { $ref: '#/components/schemas/ExplorePerson' } },
            tags: { type: 'array', items: { $ref: '#/components/schemas/ExploreTag' } },
          } },
          pagination: { type: 'object', required: ['people_next_cursor', 'tags_next_cursor'], properties: {
            people_next_cursor: { type: ['string', 'null'] },
            tags_next_cursor: { type: ['string', 'null'] },
          } },
        },
      }, LinkPreview: {
        type: 'object',
        required: ['imageUrl'],
        properties: { imageUrl: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
          siteName: { type: 'string' }, imageWidth: { type: 'integer' }, imageHeight: { type: 'integer' } },
      }, Poll: {
        type: 'object',
        required: ['options', 'kind', 'total_votes', 'expired', 'expires_at', 'viewer_voted'],
        properties: {
          options: { type: 'array',
            items: { type: 'object', required: ['id', 'label', 'votes', 'selected'],
              properties: { id: { type: 'integer' }, label: { type: 'string' }, votes: { type: ['integer', 'null'] },
                selected: { type: 'boolean' },
                correct: { type: ['boolean', 'null'],
                  description: 'Quiz answer correctness; null until the viewer answers.' } } } },
          kind: { type: 'string', enum: ['poll', 'quiz'] },
          total_votes: { type: ['integer', 'null'] },
          explanation: { type: ['string', 'null'], description: 'Quiz explanation; null until the viewer answers.' },
          expired: { type: 'boolean' },
          expires_at: { type: ['string', 'null'], format: 'date-time' },
          viewer_voted: { type: 'boolean' },
        },
      }, QuotedPost: quotedPostSchema, Post: postSchema, Activity: {
        type: 'object',
        required: ['id', 'type', 'created_at', 'unread', 'payload'],
        properties: {
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
            depth: { type: 'integer', minimum: 1, description: 'Distance from the post whose replies were requested.' },
          } },
        ],
      }, Tag: {
        type: 'object',
        required: ['tag', 'post_count', 'follower_count', 'url', 'api_url'],
        properties: {
          tag: { type: 'string' },
          post_count: { type: 'integer', minimum: 0 },
          follower_count: { type: 'integer', minimum: 0 },
          following: { type: 'boolean', description: 'Returned when authenticated.' },
          follows_viewer: { type: 'boolean', description: 'Returned when authenticated.' },
          blocked: { type: 'boolean', description: 'Returned when authenticated.' },
          url: { type: 'string', format: 'uri' },
          api_url: { type: 'string', format: 'uri' },
        },
      }, User: {
        type: 'object',
        required: ['handle', 'bio', 'created_at', 'post_count', 'replies_count', 'follower_count',
          'following_user_count', 'following_tag_count', 'following_count', 'pinned_note', 'pinned_reply', 'url',
          'api_url'],
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
          pinned_note: { anyOf: [{ $ref: '#/components/schemas/Post' }, { type: 'null' }],
            description: 'The newest undeleted top-level note tagged #pin, or null.' },
          pinned_reply: { anyOf: [{ $ref: '#/components/schemas/Post' }, { type: 'null' }],
            description: 'The newest undeleted reply tagged #pin, or null.' },
          following: { type: 'boolean', description: 'Returned when bearer authentication is supplied.' },
          follows_viewer: { type: 'boolean', description: 'Returned when bearer authentication is supplied.' },
          blocked: { type: 'boolean', description: 'Returned when bearer authentication is supplied.' },
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

export function registerApiRoutes(app: Hono, appUrl: string | null | undefined = Bun.env.APP_URL,
  now: () => number = Date.now, configuredService?: DatabaseService,
  configuredApiUser?: (request: Request) => User | null)
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

  const apiMiddleware: MiddlewareHandler = async (c, next) => {
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
  }
  app.use('/api/*', apiMiddleware)
  app.use('/all.json', apiMiddleware)
  app.use('/latest.json', apiMiddleware)
  app.use('/hot.json', apiMiddleware)

  const jsonRateLimitMiddleware: MiddlewareHandler = async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path === '/api/v1/firehose') return next()
    const user = requestApiUser(c.req.raw)
    const identity = user ? String(user.id) : c.req.header(clientIpHeaderName()) || '-'
    const limited = await service.call('system.consumeBucketedAttempt', {
      scope: user ? 'api-json-authenticated' : 'api-json',
      identity,
      attempts: user ? AUTHENTICATED_JSON_LIMIT : JSON_LIMIT,
      bucketSeconds: JSON_WINDOW_SECONDS,
      now: now(),
    })
    if (limited) return apiError('rate_limited', 'Too many API requests', 429, limited.retryAfter)
    return next()
  }
  app.use('/api/v1/*', jsonRateLimitMiddleware)
  app.use('/all.json', jsonRateLimitMiddleware)
  app.use('/latest.json', jsonRateLimitMiddleware)
  app.use('/hot.json', jsonRateLimitMiddleware)

  registerSyndicationRoutes(app, service, appUrl)
  registerApiWriteRoutes(app, service, requestApiUser, appUrl)

  app.get('/api/openapi.json', () => jsonResponse(openApiDocument(), 200, 'public, max-age=3600'))

  const latestFeed = async (c: Context) => {
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const user = requestApiUser(c.req.raw)
    const result = await service.call('api.publicRead', { kind: 'collection', origin: apiOrigin(c.req.url, appUrl),
      ...parsed, viewerId: user?.id, excludeWhispers: true })
    if (result.status !== 'ready') return jsonResponse(null)
    if (!user) return jsonResponse(result.value)
    const state = await service.call('api.latestState', { userId: user.id })
    const unread = new Set(state.unreadIds)
    const value = result.value as { data: Array<{ id: number }>; pagination: unknown }
    return jsonResponse({ ...value, data: value.data.map(post => ({ ...post, unread: unread.has(post.id) })),
      has_unread: state.unreadCount > 0, unread_count: state.unreadCount }, 200, 'no-store')
  }
  app.get('/all.json', latestFeed)
  app.get('/latest.json', latestFeed)
  app.get('/api/v1/feeds/all', latestFeed)
  app.get('/api/v1/feeds/latest', latestFeed)

  const markAllFeedPostsRead = async (c: Context) => {
    const user = requestApiUser(c.req.raw)
    if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    let payload: unknown
    try {
      payload = await c.req.json()
    }
    catch {
      return apiError('invalid_body', 'Provide post_ids as an array of post IDs', 400)
    }
    const postIds = (payload as { post_ids?: unknown })?.post_ids
    if (!Array.isArray(postIds) || postIds.length < 1 || postIds.length > 100
      || postIds.some(id => !Number.isInteger(id) || Number(id) < 1))
    {
      return apiError('invalid_body', 'Provide 1–100 positive post_ids from the all feed', 400)
    }
    const read = await service.call('api.markLatestRead', { userId: user.id,
      postIds: [...new Set(postIds as number[])] })
    return jsonResponse({ data: { read } }, 200, 'no-store')
  }
  app.post('/api/v1/feeds/all/read', markAllFeedPostsRead)
  app.post('/api/v1/feeds/latest/read', markAllFeedPostsRead)

  const markAllFeedRead = async (c: Context) => {
    const user = requestApiUser(c.req.raw)
    if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    const read = await service.call('api.markAllLatestRead', { userId: user.id })
    return jsonResponse({ data: { read_all: true, read } }, 200, 'no-store')
  }
  app.post('/api/v1/feeds/all/read-all', markAllFeedRead)
  app.post('/api/v1/feeds/latest/read-all', markAllFeedRead)

  for (const [path, kind] of [
    ['my-feed', 'personalizedFor'], ['for-you', 'personalizedFor'], ['@', 'toMeFor'], ['to-me', 'toMeFor'],
  ] as const) {
    app.get(`/api/v1/activities/${path}`, async c => {
      const user = requestApiUser(c.req.raw)
      if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
      const parsed = parseCollectionParams(c.req.query('limit'))
      const cursorValue = c.req.query('cursor')
      const cursor = decodeActivityCursor(cursorValue)
      if (!parsed || (cursorValue && !cursor)) {
        return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
      }
      return jsonResponse(
        await service.call('api.activities', { user, origin: apiOrigin(c.req.url, appUrl), limit: parsed.limit, cursor,
          toMe: kind === 'toMeFor' }),
      )
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
        || activityIds.some(id => typeof id !== 'string' || !id || id.length > 500))
      {
        return apiError('invalid_body', 'Provide 1–100 activity_ids from this feed', 400)
      }
      const read = await service.call('api.markActivitiesRead', {
        userId: user.id,
        activityIds: [...new Set(activityIds)],
        toMe: kind === 'toMeFor',
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

  for (const [path, toMe] of [['my-feed', false], ['for-you', false], ['@', true], ['to-me', true]] as const) {
    app.get(`/api/v1/activities/${path}/conversations`, async c => {
      const user = requestApiUser(c.req.raw)
      if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
      const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
      if (!parsed || !PAGE_SIZE_CHOICES.includes(parsed.limit as PageSizeChoice)) {
        return apiError('invalid_pagination',
          `limit must be one of ${PAGE_SIZE_CHOICES.join(', ')} and cursor must be a valid opaque cursor`, 400)
      }
      return jsonResponse(await service.call('api.threadedActivityFeed', {
        user, origin: apiOrigin(c.req.url, appUrl), toMe, page: parsed.before || 1,
        pageSize: parsed.limit as PageSizeChoice,
      }), 200, 'no-store')
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
    const result = await service.call('api.publicRead', { kind: 'search', origin: apiOrigin(c.req.url, appUrl), query,
      limit: parsed.limit, offset: parsed.before || 0, viewerId: requestApiUser(c.req.raw)?.id })
    return jsonResponse(result.status === 'ready' ? result.value : null)
  })

  app.get('/api/v1/bookmarks', async c => {
    const user = requestApiUser(c.req.raw)
    if (!user) return apiError('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    const rawQuery = c.req.query('q') || ''
    const query = normalizeSearchQuery(rawQuery)
    if (rawQuery.trim().length > MAX_SEARCH_LENGTH || query && !searchExpression(query)) {
      return apiError('invalid_query', `q must contain searchable text up to ${MAX_SEARCH_LENGTH} characters`, 400)
    }
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    return jsonResponse(await service.call('api.bookmarks', { userId: user.id, origin: apiOrigin(c.req.url, appUrl),
      query, limit: parsed.limit, before: parsed.before }), 200, 'no-store')
  })

  const hotFeed = async (c: Context) => {
    const parsed = parseCollectionParams(c.req.query('limit'))
    if (!parsed) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodeHotCursor(cursorValue)
    if (cursorValue && !cursor) {
      return apiError('invalid_pagination', 'limit must be 1–100 and cursor must be a valid opaque cursor', 400)
    }
    const result = await service.call('api.publicRead', { kind: 'hot', origin: apiOrigin(c.req.url, appUrl),
      limit: parsed.limit, cursor, viewerId: requestApiUser(c.req.raw)?.id })
    return jsonResponse(result.status === 'ready' ? result.value : null)
  }
  app.get('/hot.json', hotFeed)
  app.get('/api/v1/feeds/hot', hotFeed)

  const threadedFeed = (kind: 'latest' | 'hot') => async (c: Context) => {
    const parsed = parseCollectionParams(c.req.query('limit'), c.req.query('cursor'))
    if (!parsed || !PAGE_SIZE_CHOICES.includes(parsed.limit as PageSizeChoice)) {
      return apiError('invalid_pagination',
        `limit must be one of ${PAGE_SIZE_CHOICES.join(', ')} and cursor must be a valid opaque cursor`, 400)
    }
    const page = parsed.before || 1
    return jsonResponse(await service.call('api.threadedFeed', {
      kind,
      origin: apiOrigin(c.req.url, appUrl),
      viewerId: requestApiUser(c.req.raw)?.id ?? -1,
      page,
      pageSize: parsed.limit as PageSizeChoice,
    }), 200, requestApiUser(c.req.raw) ? 'no-store' : undefined)
  }
  app.get('/api/v1/feeds/all/conversations', threadedFeed('latest'))
  app.get('/api/v1/feeds/latest/conversations', threadedFeed('latest'))
  app.get('/api/v1/feeds/hot/conversations', threadedFeed('hot'))

  app.get('/api/v1/posts/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return apiError('invalid_post_id', 'Post ID must be a positive integer', 400)
    const result = await service.call('api.publicRead', {
      kind: 'post',
      origin: apiOrigin(c.req.url, appUrl),
      id,
      viewerId: requestApiUser(c.req.raw)?.id,
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
    const result = await service.call('api.publicRead', { kind: 'replies', origin: apiOrigin(c.req.url, appUrl), id,
      limit: parsed.limit, before: parsed.before, depth, viewerId: requestApiUser(c.req.raw)?.id })
    return result.status === 'ready' ? jsonResponse(result.value) : apiError('not_found', 'Post not found', 404)
  })

  app.get('/api/v1/users/:handle', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const origin = apiOrigin(c.req.url, appUrl)
    const result = await service.call('api.profile', {
      handle,
      viewerId: requestApiUser(c.req.raw)?.id ?? null,
      origin,
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
    return collection(c, service, { handle: resolved.handle, topLevelOnly: true }, appUrl,
      requestApiUser(c.req.raw)?.id)
  })

  app.get('/api/v1/users/:handle/notes', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = await service.call('profiles.resolve', { handle })
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/notes${new URL(c.req.url).search}`, 308)
    }
    return collection(c, service, { handle: resolved.handle, topLevelOnly: true }, appUrl,
      requestApiUser(c.req.raw)?.id)
  })

  app.get('/api/v1/users/:handle/replies', async c => {
    const handle = c.req.param('handle')
    if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) return apiError('invalid_handle', 'Handle is invalid', 400)
    const resolved = await service.call('profiles.resolve', { handle })
    if (!resolved) return apiError('not_found', 'User not found', 404)
    if (resolved.alias) {
      return c.redirect(`/api/v1/users/${encodeURIComponent(resolved.handle)}/replies${new URL(c.req.url).search}`, 308)
    }
    return collection(c, service, { handle: resolved.handle, repliesOnly: true }, appUrl, requestApiUser(c.req.raw)?.id)
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
        kind: relationship === 'following/users' ? 'following' : 'followers',
        handle,
        origin: apiOrigin(c.req.url, appUrl),
        limit: parsed.limit,
        before: parsed.before,
      })
      if (result.status === 'not_found') return apiError('not_found', 'User not found', 404)
      if (result.status === 'redirect') {
        return c.redirect(
          `/api/v1/users/${encodeURIComponent(result.handle)}/${relationship}${new URL(c.req.url).search}`,
          308,
        )
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
      kind: 'followingTags',
      handle,
      origin,
      limit: parsed.limit,
      before: parsed.before,
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
    const result = await service.call('api.tagDetails', { tag, origin,
      viewerId: requestApiUser(c.req.raw)?.id ?? null })
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
    return collection(c, service, { tag }, appUrl, requestApiUser(c.req.raw)?.id)
  })

  app.get('/api/v1/explore', async c => {
    const people = parseCollectionParams(c.req.query('people_limit'), c.req.query('people_cursor'))
    const tags = parseCollectionParams(c.req.query('tags_limit'), c.req.query('tags_cursor'))
    if (!people || !tags) return apiError('invalid_pagination', 'Explore limits and cursors are invalid', 400)
    const result = await service.call('api.explore', { viewerId: requestApiUser(c.req.raw)?.id ?? -1,
      origin: apiOrigin(c.req.url, appUrl), peopleLimit: people.limit, peopleOffset: people.before || 0,
      tagsLimit: tags.limit, tagsOffset: tags.before || 0 }) as {
        people: unknown[]
        tags: unknown[]
        people_has_more: boolean
        tags_has_more: boolean
      }
    return jsonResponse({ data: { people: result.people, tags: result.tags }, pagination: {
      people_next_cursor: result.people_has_more ? encodeCursor((people.before || 0) + people.limit) : null,
      tags_next_cursor: result.tags_has_more ? encodeCursor((tags.before || 0) + tags.limit) : null,
    } }, 200, requestApiUser(c.req.raw) ? 'no-store' : undefined)
  })

  app.get('/api/v1/firehose', c => {
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
