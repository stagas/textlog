import type { Context, Hono, Next } from 'hono'
import React from 'react'
import { apiOrigin } from '../api'
import { appName } from '../brand'
import { PersonalizedFeedLanding } from '../components/personalized-feed-landing'
import { type DatabaseService, databaseService } from '../database-service'
import { type SyndicationFormat, syndicationResponse } from '../syndication'
import { currentUser } from '../utils'
import { page } from './shared'

function feedResponse(c: Context, format: SyndicationFormat, appUrl: string | null | undefined, details: {
  title: string
  description: string
  pagePath: string
  feedPath?: string
  posts: import('../types').ApiPost[]
  omitAuthorInTitles?: boolean
}) {
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

export function registerSyndicationRoutes(app: Hono, configuredService?: DatabaseService,
  appUrl: string | null | undefined = Bun.env.APP_URL)
{
  const service = () => configuredService || databaseService()
  const name = appName()
  const latest = async (c: Context, format: SyndicationFormat, feedPath?: string) => {
    const origin = apiOrigin(c.req.url, appUrl)
    const loaded = await service().call('syndication.load', { kind: 'latest', origin })
    if (loaded.status !== 'ready') return c.text('Not found', 404)
    return feedResponse(c, format, appUrl, {
      title: `Latest notes on ${name}`,
      description: `The latest public notes posted on ${name}.`,
      pagePath: '/latest',
      feedPath,
      posts: loaded.posts,
    })
  }
  const hot = async (c: Context, format: SyndicationFormat, feedPath?: string) => {
    const origin = apiOrigin(c.req.url, appUrl)
    const loaded = await service().call('syndication.load', { kind: 'hot', origin })
    if (loaded.status !== 'ready') return c.text('Not found', 404)
    return feedResponse(c, format, appUrl, {
      title: `Hot notes on ${name}`,
      description: `Public notes currently ranked hot on ${name}.`,
      pagePath: '/hot',
      feedPath,
      posts: loaded.posts,
    })
  }
  const user = async (c: Context, requestedHandle: string, format: SyndicationFormat, feedPath?: string) => {
    if (!/^[A-Za-z0-9_]{2,24}$/.test(requestedHandle)) return c.text('Not found', 404)
    const origin = apiOrigin(c.req.url, appUrl)
    const loaded = await service().call('syndication.load', { kind: 'user', origin, identifier: requestedHandle })
    if (loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'redirect') {
      const path = feedPath?.startsWith('/api/')
        ? `/api/v1/users/${encodeURIComponent(loaded.handle)}/posts.${format}`
        : `/u/${encodeURIComponent(loaded.handle)}.${format}`
      return c.redirect(path, 301)
    }
    const pagePath = `/u/${encodeURIComponent(loaded.handle!)}`
    return feedResponse(c, format, appUrl, {
      title: `Notes by @${loaded.handle} on ${name}`,
      description: `The latest public notes posted by @${loaded.handle}.`,
      pagePath,
      feedPath,
      posts: loaded.posts,
      omitAuthorInTitles: true,
    })
  }
  const tag = async (c: Context, requestedTag: string, format: SyndicationFormat, feedPath?: string) => {
    const normalizedTag = requestedTag.toLowerCase()
    if (!/^[a-z0-9_]+$/.test(normalizedTag)) return c.text('Not found', 404)
    const origin = apiOrigin(c.req.url, appUrl)
    const pagePath = `/tag/${encodeURIComponent(normalizedTag)}`
    const loaded = await service().call('syndication.load', { kind: 'tag', origin, identifier: normalizedTag })
    if (loaded.status !== 'ready') return c.text('Not found', 404)
    return feedResponse(c, format, appUrl, {
      title: `#${normalizedTag} notes on ${name}`,
      description: `The latest public notes tagged #${normalizedTag}.`,
      pagePath,
      feedPath,
      posts: loaded.posts,
    })
  }

  const personalized = async (c: Context, key: string, format: SyndicationFormat) => {
    const origin = apiOrigin(c.req.url, appUrl)
    const loaded = await service().call('syndication.load', { kind: 'personalized', origin, identifier: key })
    if (loaded.status !== 'ready') return c.text('Not found', 404)
    const feedPath = `/feeds/for-you/${encodeURIComponent(key)}.${format}`
    const response = syndicationResponse(format, {
      title: `For You on ${name}`,
      description: `The personalized For You notes for @${loaded.viewerHandle}.`,
      pageUrl: `${origin}/for-you`,
      feedUrl: `${origin}${feedPath}`,
      posts: loaded.posts,
      activities: loaded.activities,
      postTitlePrefixes: loaded.postTitlePrefixes,
    }, 'private, no-store, max-age=0')
    response.headers.set('pragma', 'no-cache')
    response.headers.set('expires', '0')
    response.headers.set('access-control-allow-origin', '*')
    return response
  }

  for (const format of ['rss', 'atom'] as const) {
    app.get(`/latest.${format}`, c => latest(c, format))
    app.get(`/hot.${format}`, c => hot(c, format))
    app.get(`/api/v1/feeds/latest.${format}`, c => latest(c, format, `/api/v1/feeds/latest.${format}`))
    app.get(`/api/v1/feeds/hot.${format}`, c => hot(c, format, `/api/v1/feeds/hot.${format}`))
  }

  app.get('/feeds/for-you/:file', async c => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed) {
      const key = c.req.param('file')
      const origin = apiOrigin(c.req.url, appUrl)
      const loaded = await service().call('syndication.load', { kind: 'personalized', origin, identifier: key })
      if (loaded.status !== 'ready') return c.text('Not found', 404)
      const response = page(React.createElement(PersonalizedFeedLanding, {
        landingUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}`,
        rssUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}.rss`,
        atomUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}.atom`,
        user: currentUser(c.req.raw),
        created: c.req.query('created') === '1',
      }))
      response.headers.set('access-control-allow-origin', '*')
      return response
    }
    return personalized(c, parsed.name, parsed.format)
  })

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
