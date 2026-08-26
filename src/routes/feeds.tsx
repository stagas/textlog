import {
  About,
  Contact,
  decodeForYouCursor,
  Dmca,
  Feed,
  HotFeed,
  Legal,
  PublicFeed,
} from '../components/pages'
import { clientAddress, currentPage, page, redirect, rememberFeed } from './shared'

import type { Hono } from 'hono'
import { instance } from '../../instance.config'
import { backgroundDatabaseCall, databaseService } from '../database-service'
import { decodeHotCursor, hotRankingVersion } from '../hot'
import { campaignIpPseudonym } from '../ip-privacy'
import {
  donationBannerDismissedCookie,
  campaignAttributionCookie,
  feedPreference,
  notificationBannerDismissed,
  notificationUserAgent,
  safeRefererPath,
} from '../http'
import { rpcMaterializedFeedPage } from '../materialized-feed-service'
import { decodePostCursor } from '../pagination'
import { withRequestContext } from '../request-context'
import { resolvedDensity, resolvedPageSize } from '../request-preferences'
import { withAppearance } from '../theme'
import { currentUser } from '../utils'
import type { PersonalizedFeedData } from '../types'

async function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user) return false
  const userAgent = notificationUserAgent(request)
  const state = await databaseService().call('feeds.bannerState', { userId: user.id, userAgent })
  const { inviteHandled, notificationsEnabled, improvementDismissed, appearanceHandled, bioMissing, bioHandled,
    donationDismissed } = state
  const bioPending = bioMissing && !bioHandled
  if (!userAgent) {
    const choices = ['notifications', 'appearance', ...(inviteHandled ? [] : ['invite']), ...(bioPending ? ['bio'] : [])]
    return choices[Math.floor(Math.random() * choices.length)] as 'notifications' | 'appearance' | 'invite' | 'bio'
  }
  if (notificationsEnabled && !improvementDismissed) return 'notification-update'
  const notificationsHandled = notificationBannerDismissed(request, user.id) || state.notificationsHandled
  if (notificationsHandled && appearanceHandled && (!inviteHandled || bioPending)) {
    const choices = [...(inviteHandled ? [] : ['invite']), ...(bioPending ? ['bio'] : [])]
    return choices[Math.floor(Math.random() * choices.length)] as 'invite' | 'bio'
  }
  if (notificationsHandled && appearanceHandled) {
    return instance.links.donate && !donationDismissed ? 'donate' : false
  }
  if (notificationsHandled) return 'appearance'
  if (appearanceHandled) return 'notifications'
  if (!inviteHandled && Math.random() < 1 / 3) return 'invite'
  return Math.random() < 0.5 ? 'notifications' : 'appearance'
}

type PrimaryFeed = 'for-you' | 'latest' | 'hot'
const positiveInteger = (value?: string) => {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
type RecentFeedVisitor = {
  density: ReturnType<typeof resolvedDensity>
  pageSize: ReturnType<typeof resolvedPageSize>
  request: Request
  user: NonNullable<ReturnType<typeof currentUser>>
}

const recentFeedVisitors = new Map<number, RecentFeedVisitor>()
const recentFeedVisitorLimit = 30

const feedVariantCookieNames = new Set([
  'appearance',
  'font',
  'sans-serif-font',
  'primary-font',
  'font-size',
  'notification_device',
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
  const requestUrl = new URL('/latest', request.url).href
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

async function warmFeedPage(request: Request, kind: PrimaryFeed,
  user: NonNullable<ReturnType<typeof currentUser>> | null, pageSize: ReturnType<typeof resolvedPageSize>)
{
  const feedRequest = new Request(new URL(`/${kind}`, request.url), { headers: request.headers })
  return await withAppearance(feedRequest, async () => {
    const viewerId = user?.id ?? -1
    if (kind === 'for-you') {
      if (!user) return
      // Warm the ordered snapshot, but leave personalized HTML to a foreground request. A background render contains
      // unread indicators without consuming them, so caching it would keep serving stale dots and counts.
      await backgroundDatabaseCall('feeds.personalizedPage', {
        user,
        page: 1,
        pageSize,
        toMe: false,
        path: '/for-you',
        markRead: false,
      })
      return
    }
    if (kind === 'latest') {
      if (user && await backgroundDatabaseCall('feeds.latestUnreadCount', { userId: user.id }) > 0) return
      await rpcMaterializedFeedPage(feedRequest, kind, viewerId, async () => {
        const feed = await backgroundDatabaseCall('feeds.latestPage', { viewerId, page: 1, pageSize, markRead: false })
        return page(<PublicFeed user={user} feed={feed} path="/latest" />)
      }, false, 0, true)
      return
    }
    await rpcMaterializedFeedPage(feedRequest, kind, viewerId, async () => {
      const feed = await backgroundDatabaseCall('feeds.hotPage', { viewerId, page: 1, pageSize })
      return page(<HotFeed user={user} feed={feed} title="hot" />)
    }, false, hotRankingVersion, true)
  })
}

function warmOtherFeedPages(request: Request, current: PrimaryFeed,
  user: NonNullable<ReturnType<typeof currentUser>> | null)
{
  const pageSize = resolvedPageSize(request)
  const kinds: PrimaryFeed[] = user ? ['for-you', 'hot', 'latest'] : ['hot', 'latest']
  setTimeout(() => {
    void Promise.all(kinds.filter(kind => kind !== current)
      .map(kind => warmFeedPage(request, kind, user, pageSize))).catch(error => {
        console.error('Could not warm feed caches', error)
      })
  }, 0)
}

export function registerFeedsRoutes(app: Hono) {
  app.get('/', async c => {
    if (c.req.query('reddit') !== undefined) {
      const visitorHash = campaignIpPseudonym(clientAddress(c), 'reddit')
      if (visitorHash !== '-') {
        await databaseService().call('stats.recordCampaignVisitor', { campaign: 'reddit', visitorHash })
      }
    }
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/hot' + new URL(c.req.url).search,
      c.req.query('reddit') !== undefined ? campaignAttributionCookie('reddit') : undefined)
    const preferredFeed = feedPreference(c.req.raw)
    const path = preferredFeed === 'latest'
      ? '/latest'
      : preferredFeed === 'hot'
      ? '/hot'
      : '/for-you'
    return redirect(path + new URL(c.req.url).search)
  })

  app.get('/for-you', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const pageSize = resolvedPageSize(c.req.raw)
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () => {
      if (!dataPromise) dataPromise = databaseService().call('feeds.personalizedPage', {
        user, page: currentPage(c.req.query('page')), pageSize, toMe: false,
        path: '/for-you',
      })
      return dataPromise
    }
    const render = async () =>
      page(
        <Feed user={user} data={await data()} title="for you" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    const renderForCache = async () => {
      const feed = await data()
      const consumed = new Set(feed.timeline.filter(row => row.unread).map(row => row.event_key)).size
      return page(
        <Feed user={user} data={{ ...feed, forYouCount: Math.max(0, feed.forYouCount - consumed),
          timeline: feed.timeline.map(row => ({ ...row, unread: 0 })) }} title="for you"
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'for-you', user.id, render, false, 11, false, renderForCache,
        async () => {
          await databaseService().call('feeds.markPersonalizedSnapshotPageRead', { userId: user.id, pageSize,
            toMe: false })
        })
      : await render()
    const remembered = rememberFeed(response, 'following')
    warmOtherFeedPages(c.req.raw, 'for-you', user)
    return remembered
  })

  app.get('/latest', async c => {
    const user = currentUser(c.req.raw)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const canUseMaterializedPage = !user
      || await databaseService().call('feeds.latestUnreadCount', { userId: user.id }) === 0
    const render = async () => {
      const feed = await databaseService().call('feeds.latestPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
      return page(<PublicFeed user={user} feed={feed} path="/latest" notificationBanner={notificationBanner}
        expandedRootId={expandedRootId} />)
    }
    const response = canUseMaterializedPage && !notificationBanner
      && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'latest', user ? user.id : -1, render)
      : await render()
    const remembered = rememberFeed(response, 'latest')
    warmOtherFeedPages(c.req.raw, 'latest', user)
    return remembered
  })

  app.post('/latest/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/latest'))
    await databaseService().call('feeds.markLatestRead', { userId: user.id })
    return redirect('/latest')
  })

  app.post('/for-you/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: false })
    return redirect('/for-you')
  })

  app.get('/to-me', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const data = await databaseService().call('feeds.personalizedPage', { user, page: currentPage(c.req.query('page')),
      pageSize: resolvedPageSize(c.req.raw), toMe: true, path: '/to-me' })
    const render = () =>
      page(
        <Feed user={user} data={data} title="to me" path="/to-me" toMe notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    const renderForCache = () => {
      const consumed = new Set(data.timeline.filter(row => row.unread).map(row => row.event_key)).size
      return page(
        <Feed user={user} data={{ ...data,
          forYouCount: Math.max(0, data.forYouCount - consumed),
          toMeCount: Math.max(0, data.toMeCount - consumed),
          timeline: data.timeline.map(row => ({ ...row, unread: 0 })) }} title="to me"
          path="/to-me" toMe notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'to-me', user.id, render, false, 0, false, renderForCache)
      : render()
    return rememberFeed(response, 'following')
  })

  app.post('/to-me/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: true })
    return redirect('/to-me')
  })

  app.get('/hot', async c => {
    const user = currentUser(c.req.raw)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const render = async () => {
      const feed = await databaseService().call('feeds.hotPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
      return page(<HotFeed user={user} feed={feed} title="hot" notificationBanner={notificationBanner}
        expandedRootId={expandedRootId} />)
    }
    const response = (!user || !notificationBanner) && currentPage(c.req.query('page')) === 1 && !cursorValue
      && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'hot', user?.id ?? -1, render, false, hotRankingVersion)
      : await render()
    const remembered = rememberFeed(response, 'hot')
    warmOtherFeedPages(c.req.raw, 'hot', user)
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
    return redirect('/to-me')
  })

  app.post('/activity/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: true })
    return redirect('/to-me')
  })

  app.get('/about', async c => {
    const user = currentUser(c.req.raw)
    if (user) return page(<About user={user} />)
    return await rpcMaterializedFeedPage(c.req.raw, 'about', -1,
      async () => page(<About user={null} />))
  })
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
