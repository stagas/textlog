import {
  Connections,
  Profile,
} from '../components/pages'
import { currentPage, notFoundPage, page, paginationRedirect, redirect, safeNext } from './shared'

import type { Hono } from 'hono'
import { appName } from '../brand'
import { databaseService } from '../database-service'
import { markdownPlainText } from '../markdown'
import { renderProfileOg } from '../og'
import { CONNECTION_PAGE_SIZE, decodePostCursor, TAG_PAGE_SIZE } from '../pagination'
import { resolvedPageSize } from '../request-preferences'
import { currentUser } from '../utils'

export function registerProfilesRoutes(app: Hono) {
  app.get('/u/:handle/og.png', async c => {
    const data = await databaseService().call('profiles.ogData', { handle: c.req.param('handle') })
    if (!data) return c.text('Not found', 404)
    if (data.canonicalHandle) {
      return c.redirect(`/u/${data.canonicalHandle}/og.png`, 301)
    }
    const profile = data.profile!
    const image = renderProfileOg(profile.handle, profile.bio, profile)
    const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(image.byteLength),
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  })

  app.get('/u/:handle/:kind', async c => {
    const kind = c.req.param('kind')
    if (kind !== 'following' && kind !== 'followers' && kind !== 'blocked') return notFoundPage(c.req.raw)
    const resolved = await databaseService().call('profiles.resolve', { handle: c.req.param('handle') })
    if (!resolved) return notFoundPage(c.req.raw)
    const pageQuery = c.req.query('page') ? `&page=${encodeURIComponent(c.req.query('page')!)}` : ''
    return redirect(`/u/${resolved.handle}?tab=${kind}${pageQuery}`)
  })

  app.get('/u/:handle', async c => {
    const requestedHandle = c.req.param('handle')
    const resolved = await databaseService().call('profiles.resolve', { handle: requestedHandle })
    if (!resolved) return notFoundPage(c.req.raw)
    if (resolved.alias) {
      return c.redirect(`/u/${resolved.handle}${new URL(c.req.url).search}`, 301)
    }
    const user = currentUser(c.req.raw)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const profilePage = currentPage(c.req.query('page'))
    const tagsPage = currentPage(c.req.query('tagsPage'))
    const viewerId = user?.id ?? -1
    const overview = await databaseService().call('profiles.overview', { profileId: resolved.id, viewerId })
    if (!overview) return notFoundPage(c.req.raw)
    const { profile, bioReference, noteCount, replyCount, following, followsViewer, blocked, blockedByProfile,
      followerCount, followingCount, followingTagCount, blockedPeopleCount, blockedTagCount } = overview
    const tab = c.req.query('tab')
    if (tab && tab !== 'replies' && tab !== 'following' && tab !== 'followers' && tab !== 'blocked') {
      return notFoundPage(c.req.raw)
    }
    if (tab === 'blocked' && user?.id !== profile.id) return notFoundPage(c.req.raw)
    const total = tab === 'replies' ? replyCount : noteCount
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const profileUrl = `${origin}/u/${profile.handle}`
    const description = markdownPlainText(profile.bio) || `@${profile.handle} on ${appName()}`
    const social = {
      description,
      image: `${profileUrl}/og.png?v=2`,
      url: profileUrl,
      type: 'profile' as const,
      imageAlt: `Profile for @${profile.handle}: ${description}`,
    }
    if (blocked || blockedByProfile) {
      return page(
        <Profile user={user} profile={profile} posts={[]} following={false} blocked={blocked}
          blockedByProfile={blockedByProfile} total={0} followerCount={0} followingCount={0} followingTagCount={0}
          social={social} returnPath={returnPath} bioReference={bioReference} />,
      )
    }
    if (tab === 'blocked') {
      const { people, tags } = await databaseService().call('profiles.blockedPage', {
        profileId: profile.id,
        page: profilePage,
      })
      const outOfRange = paginationRedirect(profilePage, blockedPeopleCount, `/u/${profile.handle}?tab=blocked`)
      if (outOfRange) return outOfRange
      return page(
        <Connections user={user} profile={profile} people={people} tags={tags} kind="blocked" page={profilePage}
          total={blockedPeopleCount} noteCount={noteCount} replyCount={replyCount} followerCount={followerCount}
          followingCount={followingCount} followingTagCount={followingTagCount} following={following}
          blockedPeopleCount={blockedPeopleCount} blockedTagCount={blockedTagCount} social={social}
          returnPath={returnPath} />,
      )
    }
    if (tab === 'following' || tab === 'followers') {
      const connectionPage = profilePage
      const connection = await databaseService().call('profiles.connectionsPage', {
        profileId: profile.id,
        viewerId,
        page: connectionPage,
        tagsPage,
        kind: tab,
      })
      const { people, tags, total: connectionTotal } = connection
      const lastConnectionPage = Math.max(1, Math.ceil(connectionTotal / CONNECTION_PAGE_SIZE))
      if (connectionPage > lastConnectionPage) {
        const query = new URLSearchParams({ tab })
        if (tab === 'following') {
          if (lastConnectionPage > 1) query.set('page', String(lastConnectionPage))
          if (tagsPage > 1) query.set('tagsPage', String(tagsPage))
        }
        else if (lastConnectionPage > 1) query.set('page', String(lastConnectionPage))
        return redirect(`/u/${profile.handle}?${query}`)
      }
      if (tab === 'following') {
        const lastTagPage = Math.max(1, Math.ceil(followingTagCount / TAG_PAGE_SIZE))
        if (tagsPage > lastTagPage) {
          const query = new URLSearchParams({ tab: 'following' })
          if (connectionPage > 1) query.set('page', String(connectionPage))
          if (lastTagPage > 1) query.set('tagsPage', String(lastTagPage))
          return redirect(`/u/${profile.handle}?${query}`)
        }
      }
      return page(
        <Connections user={user} profile={profile} people={people} tags={tags} kind={tab} page={connectionPage}
          total={connectionTotal} tagsPage={tagsPage} tagsTotal={followingTagCount} noteCount={noteCount}
          replyCount={replyCount} followerCount={followerCount} followingCount={followingCount}
          followingTagCount={followingTagCount} following={following} followsViewer={followsViewer}
          blockedPeopleCount={blockedPeopleCount} blockedTagCount={blockedTagCount} social={social}
          returnPath={returnPath} />,
      )
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const snapshot = await databaseService().call('profiles.postsPage', { profileId: profile.id, viewerId,
      page: profilePage, pageSize: resolvedPageSize(c.req.raw), kind: tab === 'replies' ? 'replies' : 'notes' })
    return page(
      <Profile user={user} profile={profile} posts={blocked || blockedByProfile ? [] : snapshot.posts}
        following={following} followsViewer={followsViewer} blocked={blocked} total={total} noteCount={noteCount}
        replyCount={replyCount} tab={tab === 'replies' ? 'replies' : 'notes'} followerCount={followerCount}
        followingCount={followingCount} followingTagCount={followingTagCount} blockedPeopleCount={blockedPeopleCount}
        blockedTagCount={blockedTagCount} social={social} page={snapshot.page} totalPages={snapshot.totalPages}
        returnPath={returnPath} bioReference={bioReference} />,
    )
  })
}
