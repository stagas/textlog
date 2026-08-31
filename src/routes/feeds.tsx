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
import { clientAddress, currentPage, page, redirect, rememberFeed } from './shared'

import type { Context, Hono } from 'hono'
import { instance } from '../../instance.config'
import { backgroundDatabaseCall, databaseService } from '../database-service'
import { decodeHotCursor, hotRankingVersion } from '../hot'
import {
  campaignAttributionCookie,
  donationBannerDismissedCookie,
  feedPreference,
  notificationBannerDismissed,
  notificationUserAgent,
  pwaInstallBannerDismissedCookie,
  retainedAnyFeedPage,
  retainedAnyFeedPageCookie,
  safeRefererPath,
} from '../http'
import { campaignIpPseudonym } from '../ip-privacy'
import { rpcMaterializedFeedPage } from '../materialized-feed-service'
import { decodePostCursor } from '../pagination'
import { resolvedDensity, resolvedPageSize } from '../request-preferences'
import { withRequestContext } from '../request-context'
import { withAppearance } from '../theme'
import type { PersonalizedFeedData, PostFeedPage } from '../types'
import { currentUser } from '../utils'

async function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user) return false
  const userAgent = notificationUserAgent(request)
  const state = await databaseService().call('feeds.bannerState', { userId: user.id, userAgent })
  const { inviteHandled, notificationsEnabled, improvementDismissed, appearanceHandled, bioMissing, bioHandled,
    donationDismissed } = state
  const bioPending = bioMissing && !bioHandled
  if (!userAgent) {
    const choices = ['notifications', 'appearance', ...(inviteHandled ? [] : ['invite']),
      ...(bioPending ? ['bio'] : [])]
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

function viewerCacheVersion(base: number, user: ReturnType<typeof currentUser>) {
  return base * 2 + (user?.show_moderated_content === 1 ? 1 : 0)
}

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
const latestFeedCacheVersion = 15
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
    density: visitor.density }, () => withAppearance(visitor.request, async () => {
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
  const moved = (path: string) => (c: Context) =>
    c.redirect(path + new URL(c.req.url).search, 308)
  app.get('/for-you', moved('/my-feed'))
  app.get('/to-me', moved('/@'))
  app.get('/random', moved('/any'))
  app.get('/latest', moved('/all'))
  app.post('/for-you/read-all', moved('/my-feed/read-all'))
  app.post('/to-me/read-all', moved('/@/read-all'))
  app.post('/latest/read-all', moved('/all/read-all'))

  app.get('/', async c => {
    if (c.req.query('reddit') !== undefined) {
      const visitorHash = campaignIpPseudonym(clientAddress(c), 'reddit')
      if (visitorHash !== '-') {
        await databaseService().call('stats.recordCampaignVisitor', { campaign: 'reddit', visitorHash })
      }
    }
    const user = currentUser(c.req.raw)
    if (!user) {
      return redirect('/hot' + new URL(c.req.url).search,
        c.req.query('reddit') !== undefined ? campaignAttributionCookie('reddit') : undefined)
    }
    const preferredFeed = feedPreference(c.req.raw)
    const path = preferredFeed === 'latest'
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

  app.get('/my-feed', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/my-feed'))
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
          expandedRootId={expandedRootId} />,
      )
    const renderForCache = async () => {
      const feed = await databaseService().call('feeds.personalizedPage', {
        user,
        page: currentPage(c.req.query('page')),
        pageSize,
        toMe: false,
        path: '/my-feed',
        markRead: false,
      })
      return page(
        <Feed user={user} data={feed} title="my feed"
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'for-you', user.id, render, false,
        viewerCacheVersion(12, user), false, renderForCache,
        async () => {
          await databaseService().call('feeds.markPersonalizedSnapshotPageRead', { userId: user.id, pageSize,
            toMe: false })
        })
      : await render()
    const remembered = rememberFeed(response, 'following')
    return remembered
  })

  app.get('/all', async c => {
    const user = currentUser(c.req.raw)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    let dataPromise: Promise<PostFeedPage> | undefined
    const data = () => dataPromise ||= databaseService().call('feeds.latestPage', { viewerId: user?.id ?? -1,
      page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
    const render = async () => {
      const feed = await data()
      return page(
        <PublicFeed user={user} feed={feed} path="/all" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    }
    const renderForCache = user ? async () => {
      const feed = await databaseService().call('feeds.latestPage', { viewerId: user.id,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw), markRead: false })
      return page(
        <PublicFeed user={user} feed={feed} path="/all"
          notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    } : undefined
    const response = !notificationBanner
        && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'latest', user ? user.id : -1, render, false,
        viewerCacheVersion(latestFeedCacheVersion, user), false, renderForCache,
        user ? async () => { await data() } : undefined)
      : await render()
    const remembered = rememberFeed(response, 'latest')
    return remembered
  })

  app.get('/any', async c => {
    const user = currentUser(c.req.raw)
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const refresh = c.req.query('refresh') !== undefined
    const retainedPage = retainedAnyFeedPage(c.req.raw)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const feed = await databaseService().call('feeds.randomPage', {
      viewerId: user?.id ?? -1,
      pageSize: resolvedPageSize(c.req.raw),
      ...(refresh ? { excludePage: retainedPage || undefined } : { samplePage: retainedPage || undefined }),
    })
    const response = rememberFeed(page(
      <PublicFeed user={user} feed={feed} path="/any" notificationBanner={notificationBanner}
        expandedRootId={expandedRootId} />,
    ), 'random')
    response.headers.append('set-cookie', retainedAnyFeedPageCookie(feed.randomSamplePage || 1))
    return response
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

  app.get('/@', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/@'))
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () => dataPromise ||= databaseService().call('feeds.personalizedPage', {
      user, page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw), toMe: true, path: '/@',
    })
    const render = async () =>
      page(
        <Feed user={user} data={await data()} title="@" path="/@" toMe notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    const renderForCache = async () => {
      const feed = await data()
      const consumed = new Set(feed.timeline.filter(row => row.unread).map(row => row.event_key)).size
      return page(
        <Feed user={user}
          data={{ ...feed, forYouCount: Math.max(0, feed.forYouCount - consumed),
            toMeCount: Math.max(0, feed.toMeCount - consumed),
            timeline: feed.timeline.map(row => ({ ...row, unread: 0 })) }} title="@" path="/@" toMe
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'to-me', user.id, render, false,
        viewerCacheVersion(0, user), false, renderForCache)
      : await render()
    return rememberFeed(response, 'activity')
  })

  app.post('/@/read-all', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/@'))
    await databaseService().call('feeds.markRead', { userId: user.id, toMe: true })
    return redirect('/@')
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
      return page(
        <HotFeed user={user} feed={feed} title="hot" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    }
    const response = (!user || !notificationBanner) && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId
      ? await rpcMaterializedFeedPage(c.req.raw, 'hot', user?.id ?? -1, render, false,
        viewerCacheVersion(hotRankingVersion, user))
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
  app.get('/install', c => page(
    <InstallGuide user={currentUser(c.req.raw)} platform={installPlatform(c.req.raw)} />,
  ))
  app.post('/install/banner/dismiss', c => redirect(
    safeRefererPath(c.req.header('referer'), c.req.url),
    pwaInstallBannerDismissedCookie(),
  ))
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
