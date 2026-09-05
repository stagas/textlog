import {
  About,
  Contact,
  decodeForYouCursor,
  Dmca,
  Feed,
  HotFeed,
  InstallGuide,
  installPlatform,
  Legal,
  PublicFeed,
} from '../components/pages'
import { currentPage, form, page, redirect, rememberFeed } from './shared'

import type { Context, Hono } from 'hono'
import { randomInt } from 'node:crypto'
import { instance } from '../../instance.config'
import { executePostCode } from '../code-execution'
import { backgroundDatabaseCall, databaseService } from '../database-service'
import { decodeHotCursor, hotRankingVersion } from '../hot'
import {
  campaignAttributionCookie,
  donationBannerDismissedCookie,
  feedPreference,
  notificationBannerDismissed,
  notificationUserAgent,
  pwaInstallBannerDismissedCookie,
  retainedAnyFeedSeed,
  retainedAnyFeedSeedCookie,
  safeRefererPath,
} from '../http'
import { rpcMaterializedFeedPage } from '../materialized-feed-service'
import { decodePostCursor } from '../pagination'
import { normalizePostBody, postBodyValidationMessage, validPostBody } from '../post-body'
import { withRequestContext } from '../request-context'
import { resolvedDensity, resolvedPageSize } from '../request-preferences'
import { withAppearance } from '../theme'
import type { PersonalizedFeedData, PostFeedPage } from '../types'
import { currentUser } from '../utils'
import { previewLocation } from './posts'

async function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user) return false
  // Keep the selected banner stable for this account state. Random selection fragmented the materialized feed cache:
  // the same viewer could populate several otherwise identical multi-hundred-kilobyte pages.
  const choose = <T,>(choices: T[]) => choices[user.id % choices.length]
  const userAgent = notificationUserAgent(request)
  const state = await databaseService().call('feeds.bannerState', { userId: user.id, userAgent })
  const { inviteHandled, notificationsEnabled, improvementDismissed, appearanceHandled, bioMissing, bioHandled,
    donationDismissed } = state
  const bioPending = bioMissing && !bioHandled
  if (!userAgent) {
    const choices = ['notifications', 'appearance', ...(inviteHandled ? [] : ['invite']),
      ...(bioPending ? ['bio'] : [])]
    return choose(choices) as 'notifications' | 'appearance' | 'invite' | 'bio'
  }
  if (notificationsEnabled && !improvementDismissed) return 'notification-update'
  const notificationsHandled = notificationBannerDismissed(request, user.id) || state.notificationsHandled
  if (notificationsHandled && appearanceHandled && (!inviteHandled || bioPending)) {
    const choices = [...(inviteHandled ? [] : ['invite']), ...(bioPending ? ['bio'] : [])]
    return choose(choices) as 'invite' | 'bio'
  }
  if (notificationsHandled && appearanceHandled) {
    return instance.links.donate && !donationDismissed ? 'donate' : false
  }
  if (notificationsHandled) return 'appearance'
  if (appearanceHandled) return 'notifications'
  if (!inviteHandled && user.id % 3 === 0) return 'invite'
  return user.id % 2 === 0 ? 'notifications' : 'appearance'
}

function viewerCacheVersion(base: number, user: ReturnType<typeof currentUser>,
  banner: Awaited<ReturnType<typeof showNotificationBanner>> = false)
{
  const feedPresentationVersion = 1
  const bannerVersion = banner
    ? ['notifications', 'appearance', 'invite', 'bio', 'notification-update', 'donate'].indexOf(banner) + 1
    : 0
  return (base * 100 + feedPresentationVersion * 2 + (user?.show_moderated_content === 1 ? 1 : 0)) * 10
    + bannerVersion
}

function personalizedFeedAfterVisibleReads(data: PersonalizedFeedData, toMe: boolean): PersonalizedFeedData {
  const consumed = new Set(data.timeline.filter(row => row.unread).map(row => row.event_key)).size
  return {
    ...data,
    forYouCount: Math.max(0, data.forYouCount - consumed),
    toMeCount: Math.max(0, data.toMeCount - (toMe ? consumed : 0)),
    forYouUnread: toMe ? data.forYouUnread : data.forYouCount > consumed,
    toMeUnread: toMe ? data.toMeCount > consumed : data.toMeUnread,
    timeline: data.timeline.map(row => ({ ...row, unread: 0 })),
  }
}

function latestFeedAfterVisibleReads(feed: PostFeedPage): PostFeedPage {
  const consumed = new Set(feed.unreadPostIds || []).size
  const latestCount = Math.max(0, (feed.latestCount || 0) - consumed)
  return { ...feed, latestCount, latestUnread: latestCount > 0, unreadPostIds: [], directedUnreadPostIds: [] }
}

const positiveInteger = (value?: string) => {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
const anySeed = (value?: string) => {
  if (!value || !/^[0-9a-z]+$/.test(value)) return undefined
  const parsed = Number.parseInt(value, 36)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < 2_147_483_647 ? parsed : undefined
}
const writeState = async (c: Context) => {
  if (c.req.method === 'POST') {
    const fields = await form(c.req.raw)
    const writeBody = normalizePostBody(fields.body || '')
    if (fields.action !== 'preview' || fields.embedded !== '1') {
      return { writeError: 'Unsupported feed action.', writeBody }
    }
    if (!validPostBody(writeBody)) return { writeError: postBodyValidationMessage(writeBody), writeBody }
    const user = currentUser(c.req.raw)
    let writeDraftId: string | undefined
    if (user) {
      const requestedDraftId = /^[0-9a-f-]{32,36}$/i.test(fields.draft_id || '') ? fields.draft_id : null
      const result = await databaseService().call('drafts.save', {
        id: requestedDraftId,
        userId: user.id,
        parentId: null,
        body: writeBody,
      })
      if (result.status === 'not_found') return { writeError: 'Draft not found.', writeBody }
      writeDraftId = result.id
      user.draft_count = Math.max(user.draft_count || 0, 1)
    }
    return {
      writeBody,
      writeDraftId,
      writePreview: true,
      writePreviewExecutionOutput: await executePostCode(writeBody),
      writePreviewLocation: await previewLocation(writeBody),
    }
  }
  const writeBody = c.req.query('write_body')
  const writePreview = c.req.query('write_preview') === '1' && writeBody !== undefined
  return {
    writeError: c.req.query('write_error'),
    writeBody,
    writeDraftId: c.req.query('write_draft_id'),
    writePreview,
    writePreviewExecutionOutput: writePreview ? await executePostCode(writeBody) : undefined,
    writePreviewLocation: writePreview ? await previewLocation(writeBody) : undefined,
  }
}
type RecentFeedVisitor = {
  density: ReturnType<typeof resolvedDensity>
  pageSize: ReturnType<typeof resolvedPageSize>
  request: Request
  user: NonNullable<ReturnType<typeof currentUser>>
}

const recentFeedVisitors = new Map<number, RecentFeedVisitor>()
const latestFeedCacheVersion = 15
const newFeedCacheVersion = 1
const recentFeedVisitorLimit = 30
let recentLatestWarmCursor = 0

const feedVariantCookieNames = new Set([
  'appearance',
  'font',
  'sans-serif-font',
  'primary-font',
  'font-size',
  'notification_device',
  'pwa_standalone',
  'pwa_install_banner_dismissed',
])

function feedVariantCookie(request: Request) {
  return (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => {
    const separator = value.indexOf('=')
    return separator > 0 && feedVariantCookieNames.has(value.slice(0, separator))
  }).join('; ')
}

function rememberFeedVisitor(request: Request, user: NonNullable<ReturnType<typeof currentUser>> | null) {
  if (!user) return
  const density = resolvedDensity(request)
  const pageSize = resolvedPageSize(request)
  const cookie = feedVariantCookie(request)
  const requestUrl = new URL('/all', request.url).href
  recentFeedVisitors.delete(user.id)
  recentFeedVisitors.set(user.id, {
    density,
    pageSize,
    user,
    request: new Request(requestUrl, { headers: { cookie } }),
  })
  while (recentFeedVisitors.size > recentFeedVisitorLimit) {
    recentFeedVisitors.delete(recentFeedVisitors.keys().next().value!)
  }
  void backgroundDatabaseCall('cache.recentFeedVisitorPut', {
    userId: user.id,
    requestUrl,
    cookie,
    pageSize,
    density,
  }).catch(error => console.error('Could not remember recent feed visitor', error))
}

export async function warmNextRecentLatestFeed() {
  const visitors = [...recentFeedVisitors.values()].reverse()
  if (!visitors.length) return
  const visitor = visitors[recentLatestWarmCursor++ % visitors.length]
  await withRequestContext({ sessionUser: visitor.user, apiUser: null, pageSize: visitor.pageSize,
    density: visitor.density }, () =>
    withAppearance(visitor.request, async () => {
      await rpcMaterializedFeedPage(visitor.request, 'latest', visitor.user.id, async () => {
        const feed = await backgroundDatabaseCall('feeds.latestPage', {
          viewerId: visitor.user.id,
          page: 1,
          pageSize: visitor.pageSize,
          markRead: false,
        })
        return page(<PublicFeed user={visitor.user} feed={feed} path="/all" />)
      }, false, viewerCacheVersion(latestFeedCacheVersion, visitor.user), true)
    }))
}

export async function warmRecentLatestFeeds(limit = 5) {
  const count = Math.min(limit, recentFeedVisitors.size)
  for (let index = 0; index < count; index++) await warmNextRecentLatestFeed()
}

export async function loadRecentFeedVisitors() {
  const visitors = await databaseService().call('cache.recentFeedVisitors', {})
  for (const visitor of visitors) {
    recentFeedVisitors.set(visitor.user.id, {
      user: visitor.user,
      request: new Request(visitor.requestUrl, { headers: { cookie: visitor.cookie } }),
      pageSize: visitor.pageSize,
      density: visitor.density,
    })
  }
}

export function registerFeedsRoutes(app: Hono) {
  const moved = (path: string) => (c: Context) => c.redirect(path + new URL(c.req.url).search, 308)
  app.get('/for-you', moved('/my-feed'))
  app.get('/to-me', moved('/@'))
  app.get('/random', moved('/any'))
  app.get('/latest', moved('/all'))
  app.post('/for-you/read-all', moved('/my-feed/read-all'))
  app.post('/to-me/read-all', moved('/@/read-all'))
  app.post('/latest/read-all', moved('/all/read-all'))

  app.get('/', async c => {
    const user = currentUser(c.req.raw)
    if (!user) {
      const campaign = c.req.query('reddit') !== undefined
        ? 'reddit'
        : c.req.query('4chan') !== undefined
        ? '4chan'
        : null
      return redirect('/hot' + new URL(c.req.url).search, campaign ? campaignAttributionCookie(campaign) : undefined)
    }
    const preferredFeed = feedPreference(c.req.raw)
    const path = preferredFeed === 'new'
      ? '/new'
      : preferredFeed === 'latest'
      ? '/all'
      : preferredFeed === 'hot'
      ? '/hot'
      : preferredFeed === 'random'
      ? '/any'
      : preferredFeed === 'activity'
      ? '/@'
      : '/my-feed'
    return redirect(path + new URL(c.req.url).search)
  })

  app.on(['GET', 'POST'], '/my-feed', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/my-feed'))
    const write = await writeState(c)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const pageSize = resolvedPageSize(c.req.raw)
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () => {
      if (!dataPromise) {
        dataPromise = databaseService().call('feeds.personalizedPage', {
          user,
          page: currentPage(c.req.query('page')),
          pageSize,
          toMe: false,
          path: '/my-feed',
        })
      }
      return dataPromise
    }
    const render = async () =>
      page(
        <Feed user={user} data={await data()} title="my feed" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} {...write} />,
      )
    const renderForCache = async () => {
      const feed = personalizedFeedAfterVisibleReads(await data(), false)
      return page(
        <Feed user={user} data={feed} title="my feed" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    }
    const response = !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'for-you', user.id, render, false,
        viewerCacheVersion(12, user, notificationBanner), false, renderForCache, async () => {
        return await databaseService().call('feeds.markPersonalizedSnapshotPageRead', { userId: user.id, pageSize,
          toMe: false }) > 0
      })
      : await render()
    const remembered = rememberFeed(response, 'following')
    return remembered
  })

  app.on(['GET', 'POST'], '/all', async c => {
    const user = currentUser(c.req.raw)
    const write = await writeState(c)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    let dataPromise: Promise<PostFeedPage> | undefined
    const data = () =>
      dataPromise ||= databaseService().call('feeds.latestPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
    const render = async () => {
      const feed = await data()
      return page(
        <PublicFeed user={user} feed={feed} path="/all" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} {...write} />,
      )
    }
    const renderForCache = user
      ? async () => {
        const feed = latestFeedAfterVisibleReads(await data())
        return page(
          <PublicFeed user={user} feed={feed} path="/all" notificationBanner={notificationBanner}
            expandedRootId={expandedRootId} />,
        )
      }
      : undefined
    const response = !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'latest', user ? user.id : -1, render, false,
        viewerCacheVersion(latestFeedCacheVersion, user, notificationBanner), false, renderForCache)
      : await render()
    const remembered = rememberFeed(response, 'latest')
    return remembered
  })

  app.on(['GET', 'POST'], '/any', async c => {
    const user = currentUser(c.req.raw)
    const write = await writeState(c)
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const requestedSeed = anySeed(c.req.query('seed'))
    const retainedSeed = retainedAnyFeedSeed(c.req.raw)
    if (!requestedSeed && !retainedSeed) {
      const seed = randomInt(1, 2_147_483_647)
      return redirect(`/any?seed=${seed.toString(36)}`, retainedAnyFeedSeedCookie(seed))
    }
    const seed = requestedSeed || retainedSeed!
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const feed = await databaseService().call('feeds.randomPage', {
      viewerId: user?.id ?? -1,
      pageSize: resolvedPageSize(c.req.raw),
      sampleSeed: seed,
    })
    const response = rememberFeed(page(
      <PublicFeed user={user} feed={feed} path={`/any?seed=${seed.toString(36)}`}
        notificationBanner={notificationBanner} expandedRootId={expandedRootId} {...write} />,
    ), 'random')
    response.headers.append('set-cookie', retainedAnyFeedSeedCookie(seed))
    return response
  })

  app.on(['GET', 'POST'], '/new', async c => {
    const user = currentUser(c.req.raw)
    const write = await writeState(c)
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const render = async () => {
      const feed = await databaseService().call('feeds.newPage', {
        viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')),
        pageSize: resolvedPageSize(c.req.raw),
      })
      return page(
        <PublicFeed user={user} feed={feed} path="/new" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} {...write} />,
      )
    }
    const response = !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'new', user?.id ?? -1, render, false,
        viewerCacheVersion(newFeedCacheVersion, user, notificationBanner))
      : await render()
    return rememberFeed(response, 'new')
  })

  app.post('/all/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/all'))
    await databaseService().call('feeds.markLatestRead', { userId: user.id })
    return redirect('/all')
  })

  app.post('/my-feed/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/my-feed'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: false })
    return redirect('/my-feed')
  })

  app.on(['GET', 'POST'], '/@', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/@'))
    const write = await writeState(c)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () =>
      dataPromise ||= databaseService().call('feeds.personalizedPage', {
        user,
        page: currentPage(c.req.query('page')),
        pageSize: resolvedPageSize(c.req.raw),
        toMe: true,
        path: '/@',
      })
    const render = async () =>
      page(
        <Feed user={user} data={await data()} title="@" path="/@" toMe notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} {...write} />,
      )
    const renderForCache = async () => {
      const feed = await data()
      return page(
        <Feed user={user} data={personalizedFeedAfterVisibleReads(feed, true)} title="@" path="/@" toMe
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'to-me', user.id, render, false,
        viewerCacheVersion(0, user, notificationBanner), false, renderForCache)
      : await render()
    return rememberFeed(response, 'activity')
  })

  app.post('/@/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/@'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: true })
    return redirect('/@')
  })

  app.on(['GET', 'POST'], '/hot', async c => {
    const user = currentUser(c.req.raw)
    const write = await writeState(c)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const render = async () => {
      const feed = await databaseService().call('feeds.hotPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
      return page(
        <HotFeed user={user} feed={feed} title="hot" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} {...write} />,
      )
    }
    const response = !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'hot', user?.id ?? -1, render, false,
        viewerCacheVersion(hotRankingVersion, user, notificationBanner))
      : await render()
    const remembered = rememberFeed(response, 'hot')
    return remembered
  })

  app.post('/notifications/banner/dismiss', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const destination = safeRefererPath(c.req.header('referer'), c.req.url)
    const userAgent = notificationUserAgent(c.req.raw)
    await databaseService().call('feeds.recordBanner', {
      userId: user.id,
      userAgent,
      action: 'notifications-dismissed',
    })
    return redirect(destination)
  })

  app.post('/notifications/improvements/dismiss', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const userAgent = notificationUserAgent(c.req.raw)
    await databaseService().call('feeds.recordBanner', {
      userId: user.id,
      userAgent,
      action: 'notification-improvements-dismissed',
    })
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
  })

  app.post('/appearance/banner/dismiss', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: notificationUserAgent(c.req.raw),
      action: 'appearance-dismissed' })
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
  })

  app.post('/invite/banner/dismiss', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: null, action: 'invite-dismissed' })
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
  })

  app.get('/bio/banner/accept', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit'))
    await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: null, action: 'bio-dismissed' })
    return redirect('/account/edit')
  })

  app.post('/bio/banner/dismiss', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: null, action: 'bio-dismissed' })
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
  })

  app.get('/donation/banner/accept', async c => {
    if (!instance.links.donate) return redirect('/')
    const user = currentUser(c.req.raw)
    if (user) {
      await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: null,
        action: 'donation-dismissed' })
      return redirect(instance.links.donate)
    }
    return redirect(instance.links.donate, donationBannerDismissedCookie())
  })

  app.post('/donation/banner/dismiss', async c => {
    const user = currentUser(c.req.raw)
    const destination = safeRefererPath(c.req.header('referer'), c.req.url)
    if (!user) return redirect(destination, donationBannerDismissedCookie())
    await databaseService().call('feeds.recordBanner', { userId: user.id, userAgent: null,
      action: 'donation-dismissed' })
    return redirect(destination)
  })

  app.get('/activity', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    return redirect('/@')
  })

  app.post('/activity/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: true })
    return redirect('/@')
  })

  app.get('/about', async c => {
    const user = currentUser(c.req.raw)
    if (user) return page(<About user={user} />)
    return await rpcMaterializedFeedPage(c.req.raw, 'about', -1, async () => page(<About user={null} />))
  })
  app.get('/install', c =>
    page(
      <InstallGuide user={currentUser(c.req.raw)} platform={installPlatform(c.req.raw)} />,
    ))
  app.post('/install/banner/dismiss', c =>
    redirect(
      safeRefererPath(c.req.header('referer'), c.req.url),
      pwaInstallBannerDismissedCookie(),
    ))
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
