import { currentPage, page, paginationRedirect, safeNext } from './shared'

import type { Hono } from 'hono'
import { appName } from '../brand'
import {
  TagFeed,
} from '../components/pages'
import { normalizeHashtagSpelling } from '../content'
import { databaseService } from '../database-service'
import { renderTagOg } from '../og'
import { cachedOgResponse, cacheOgResponse } from '../og-response-cache'
import { CONNECTION_PAGE_SIZE } from '../pagination'
import { resolvedPageSize } from '../request-preferences'
import { currentUser } from '../utils'

export function registerTagsRoutes(app: Hono) {
  app.get('/tag/:tag/og.png', async c => {
    const rawTag = c.req.param('tag')
    const requestedTag = normalizeHashtagSpelling(rawTag)
    const tag = await databaseService().call('tags.resolve', { tag: requestedTag })
    if (tag !== rawTag) return c.redirect(`/tag/${encodeURIComponent(tag)}/og.png`, 301)
    const cacheKey = `tag:${tag}`
    const cached = cachedOgResponse(cacheKey)
    if (cached) return cached
    const total = await databaseService().call('tags.count', { tag })
    const image = renderTagOg(tag, total)
    return cacheOgResponse(cacheKey, image, {
      'content-type': 'image/png',
      'content-length': String(image.byteLength),
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    })
  })

  app.get('/tag/:tag', async c => {
    const requestedTag = c.req.param('tag')
    const normalizedTag = normalizeHashtagSpelling(requestedTag)
    const tag = await databaseService().call('tags.resolve', { tag: normalizedTag })
    if (requestedTag !== tag) {
      return c.redirect(`/tag/${encodeURIComponent(tag)}${new URL(c.req.url).search}`, 301)
    }
    const user = currentUser(c.req.raw)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const tagPage = currentPage(c.req.query('page'))
    const tab = c.req.query('tab')
    if (tab && tab !== 'followers') return c.notFound()
    const viewerId = user?.id ?? -1
    const notePageSize = resolvedPageSize(c.req.raw)
    const data = await databaseService().call('tags.page', { tag, viewerId, page: tagPage, pageSize: notePageSize,
      tab: tab === 'followers' ? 'followers' : 'notes' })
    const { aliases, displayName, following, blocked, posts, total, followerTotal, people } = data
    const tabPath = `/tag/${encodeURIComponent(tag)}${tab === 'followers' ? '?tab=followers' : ''}`
    const outOfRange = paginationRedirect(tagPage, tab === 'followers' ? followerTotal : total, tabPath,
      tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize)
    if (outOfRange) return outOfRange
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const tagUrl = `${origin}/tag/${encodeURIComponent(tag)}`
    const description = `${total} ${total === 1 ? 'note' : 'notes'} tagged #${tag} on ${appName()}`
    const social = {
      description,
      image: `${tagUrl}/og.png?v=2`,
      url: tagUrl,
      type: 'website' as const,
      imageAlt: `#${tag}: ${description}`,
    }
    return page(
      <TagFeed user={user} tag={tag} displayName={displayName} aliases={aliases} following={following} blocked={blocked}
        posts={posts} page={tagPage} total={total} followerTotal={followerTotal} people={people}
        tab={tab === 'followers' ? 'followers' : 'notes'} notePageSize={notePageSize} social={social}
        returnPath={returnPath} />,
    )
  })
}
