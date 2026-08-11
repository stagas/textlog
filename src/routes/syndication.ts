import type { Database } from 'bun:sqlite'
import type { Context, Hono, Next } from 'hono'
import { API_DEFAULT_LIMIT, apiHotPosts, apiOrigin, apiPosts } from '../api'
import { db } from '../db'
import { resolveHandle } from '../handles'
import { type SyndicationFormat, syndicationResponse } from '../syndication'
import { appName } from '../brand'

function publicPosts(database: Database, origin: string, filters: { handle?: string; tag?: string } = {}) {
  return apiPosts(database, origin, { limit: API_DEFAULT_LIMIT, before: null, ...filters }).data
}

function feedResponse(c: Context, database: Database, format: SyndicationFormat, appUrl: string | null | undefined,
  details: {
    title: string
    description: string
    pagePath: string
    feedPath?: string
    posts: ReturnType<typeof publicPosts>
  })
{
  const origin = apiOrigin(c.req.url, appUrl)
  return syndicationResponse(format, {
    ...details,
    pageUrl: `${origin}${details.pagePath}`,
    feedUrl: `${origin}${details.feedPath || `${details.pagePath}.${format}`}`,
  })
}

function suffixed(value: string): { name: string; format: SyndicationFormat } | null {
  const match = value.match(/^(.+)\.(rss|atom)$/)
  return match ? { name: match[1], format: match[2] as SyndicationFormat } : null
}

export function registerSyndicationRoutes(app: Hono, database: Database = db,
  appUrl: string | null | undefined = Bun.env.APP_URL)
{
  const name = appName()
  const latest = (c: Context, format: SyndicationFormat, feedPath?: string) => {
    const origin = apiOrigin(c.req.url, appUrl)
    return feedResponse(c, database, format, appUrl, {
      title: `Latest notes on ${name}`,
      description: `The latest public notes posted on ${name}.`,
      pagePath: '/latest',
      feedPath,
      posts: publicPosts(database, origin),
    })
  }
  const hot = (c: Context, format: SyndicationFormat, feedPath?: string) => {
    const origin = apiOrigin(c.req.url, appUrl)
    return feedResponse(c, database, format, appUrl, {
      title: `Hot notes on ${name}`,
      description: `Public notes currently ranked hot on ${name}.`,
      pagePath: '/hot',
      feedPath,
      posts: apiHotPosts(database, origin, API_DEFAULT_LIMIT, null).data,
    })
  }
  const user = (c: Context, requestedHandle: string, format: SyndicationFormat, feedPath?: string) => {
    if (!/^[A-Za-z0-9_]{2,24}$/.test(requestedHandle)) return c.text('Not found', 404)
    const resolved = resolveHandle(database, requestedHandle)
    if (!resolved) return c.text('Not found', 404)
    if (resolved.alias) {
      const path = feedPath?.startsWith('/api/')
        ? `/api/v1/users/${encodeURIComponent(resolved.handle)}/posts.${format}`
        : `/u/${encodeURIComponent(resolved.handle)}.${format}`
      return c.redirect(path, 301)
    }
    const origin = apiOrigin(c.req.url, appUrl)
    const pagePath = `/u/${encodeURIComponent(resolved.handle)}`
    return feedResponse(c, database, format, appUrl, {
      title: `Notes by @${resolved.handle} on ${name}`,
      description: `The latest public notes posted by @${resolved.handle}.`,
      pagePath,
      feedPath,
      posts: publicPosts(database, origin, { handle: resolved.handle }),
    })
  }
  const tag = (c: Context, requestedTag: string, format: SyndicationFormat, feedPath?: string) => {
    const normalizedTag = requestedTag.toLowerCase()
    if (!/^[a-z0-9_]+$/.test(normalizedTag)) return c.text('Not found', 404)
    const origin = apiOrigin(c.req.url, appUrl)
    const pagePath = `/tag/${encodeURIComponent(normalizedTag)}`
    return feedResponse(c, database, format, appUrl, {
      title: `#${normalizedTag} notes on ${name}`,
      description: `The latest public notes tagged #${normalizedTag}.`,
      pagePath,
      feedPath,
      posts: publicPosts(database, origin, { tag: normalizedTag }),
    })
  }

  for (const format of ['rss', 'atom'] as const) {
    app.get(`/latest.${format}`, c => latest(c, format))
    app.get(`/hot.${format}`, c => hot(c, format))
    app.get(`/api/v1/feeds/latest.${format}`, c => latest(c, format, `/api/v1/feeds/latest.${format}`))
    app.get(`/api/v1/feeds/hot.${format}`, c => hot(c, format, `/api/v1/feeds/hot.${format}`))
  }

  app.get('/u/:file', async (c, next: Next) => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed) return next()
    return user(c, parsed.name, parsed.format)
  })

  app.get('/tag/:file', async (c, next: Next) => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed) return next()
    return tag(c, parsed.name, parsed.format)
  })

  app.get('/api/v1/users/:handle/:file', async (c, next: Next) => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed || parsed.name !== 'posts') return next()
    const feedPath = `/api/v1/users/${encodeURIComponent(c.req.param('handle'))}/posts.${parsed.format}`
    return user(c, c.req.param('handle'), parsed.format, feedPath)
  })

  app.get('/api/v1/tags/:tag/:file', async (c, next: Next) => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed || parsed.name !== 'posts') return next()
    const feedPath = `/api/v1/tags/${encodeURIComponent(c.req.param('tag').toLowerCase())}/posts.${parsed.format}`
    return tag(c, c.req.param('tag'), parsed.format, feedPath)
  })
}
