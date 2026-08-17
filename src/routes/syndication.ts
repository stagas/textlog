import type { Database } from 'bun:sqlite'
import type { Context, Hono, Next } from 'hono'
import React from 'react'
import { API_DEFAULT_LIMIT, apiHotPosts, apiOrigin, apiPosts } from '../api'
import { apiActivities } from '../api-activity'
import { appName } from '../brand'
import { db } from '../db'
import { userForFeedKey } from '../feed-keys'
import { PersonalizedFeedLanding } from '../components/personalized-feed-landing'
import { resolveHandle } from '../handles'
import { type SyndicationFormat, syndicationResponse } from '../syndication'
import { page } from './shared'
import { currentUser } from '../utils'

function publicPosts(database: Database, origin: string,
  filters: { handle?: string; tag?: string; excludeBots?: boolean } = {}) {
  return apiPosts(database, origin, { limit: API_DEFAULT_LIMIT, before: null, ...filters }).data
}

function feedResponse(c: Context, database: Database, format: SyndicationFormat, appUrl: string | null | undefined,
  details: {
    title: string
    description: string
    pagePath: string
    feedPath?: string
    posts: ReturnType<typeof publicPosts>
    omitAuthorInTitles?: boolean
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
      posts: publicPosts(database, origin, { excludeBots: true }),
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
      omitAuthorInTitles: true,
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

  const personalized = (c: Context, key: string, format: SyndicationFormat) => {
    const viewer = userForFeedKey(database, key)
    if (!viewer) return c.text('Not found', 404)
    const origin = apiOrigin(c.req.url, appUrl)
    const feedPath = `/feeds/for-you/${encodeURIComponent(key)}.${format}`
    const activities = apiActivities(database, origin, viewer, { limit: 100, cursor: null, toMe: false })
    const posts = activities.data.flatMap(activity =>
      ['post', 'reply', 'mention'].includes(activity.type) && 'body' in activity.payload ? [activity.payload] : [])
    const postTitlePrefixes = Object.fromEntries(activities.data.flatMap(activity =>
      activity.type === 'mention' && 'body' in activity.payload ? [[activity.payload.id, 'Mentioned you: ']] : []))
    const activityEntries = activities.data.flatMap(activity => {
      if (['post', 'reply', 'mention'].includes(activity.type) || 'body' in activity.payload) return []
      const { actor, target } = activity.payload
      const title = activity.type === 'signup'
        ? `@${actor.handle} signed up`
        : target && 'handle' in target
        ? `@${actor.handle} followed @${target.handle}`
        : target && 'tag' in target
        ? `@${actor.handle} followed #${target.tag}`
        : `@${actor.handle} followed someone`
      return [{ id: `${origin}/activities/${encodeURIComponent(activity.id)}`, title,
        url: target?.url || actor.url, created_at: activity.created_at, author: actor }]
    })
    const response = syndicationResponse(format, {
      title: `For You on ${name}`,
      description: `The personalized For You notes for @${viewer.handle}.`,
      pageUrl: `${origin}/for-you`,
      feedUrl: `${origin}${feedPath}`,
      posts,
      activities: activityEntries,
      postTitlePrefixes,
    }, 'private, no-store, max-age=0')
    response.headers.set('pragma', 'no-cache')
    response.headers.set('expires', '0')
    return response
  }

  for (const format of ['rss', 'atom'] as const) {
    app.get(`/latest.${format}`, c => latest(c, format))
    app.get(`/hot.${format}`, c => hot(c, format))
    app.get(`/api/v1/feeds/latest.${format}`, c => latest(c, format, `/api/v1/feeds/latest.${format}`))
    app.get(`/api/v1/feeds/hot.${format}`, c => hot(c, format, `/api/v1/feeds/hot.${format}`))
  }

  app.get('/feeds/for-you/:file', c => {
    const parsed = suffixed(c.req.param('file'))
    if (!parsed) {
      const key = c.req.param('file')
      if (!userForFeedKey(database, key)) return c.text('Not found', 404)
      const origin = apiOrigin(c.req.url, appUrl)
      return page(React.createElement(PersonalizedFeedLanding, {
        landingUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}`,
        rssUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}.rss`,
        atomUrl: `${origin}/feeds/for-you/${encodeURIComponent(key)}.atom`,
        user: currentUser(c.req.raw),
        created: c.req.query('created') === '1',
      }))
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
