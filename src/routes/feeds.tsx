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
import { htmlFragment } from './shared'

import type { Context, Hono } from 'hono'
import { randomInt } from 'node:crypto'
import { instance } from '../../instance.config'
import { subscribeToPosts } from '../api-broker'
import { executePostCode } from '../code-execution'
import { feedChunk, restoredFeedChunks } from '../components/infinite-feed'
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
import { feedWarmIdle } from '../idle-work'
import { rpcMaterializedFeedPage } from '../materialized-feed-service'
import { autotagText } from '../openrouter'
import { decodePostCursor } from '../pagination'
import { normalizePostBody, POST_MAX, postBodyValidationMessage, validPostBody } from '../post-body'
import { withRequestContext } from '../request-context'
import { resolvedDensity, resolvedPageSize } from '../request-preferences'
import { withAppearance } from '../theme'
import type { PersonalizedFeedData, PostFeedPage } from '../types'
import { currentUser } from '../utils'
import { previewLocation } from './posts'

const SSE_HEARTBEAT_MS = 5_000

async function requestedFetchedThread(c: Context, viewerId: number) {
  const id = positiveInteger(c.req.query('fetch'))
  if (!id) return undefined
  const detail = await databaseService().call('posts.detail', { id, viewerId })
  if (detail.status !== 'ready') return undefined
  const replies = await databaseService().call('posts.threadReplies', { parentId: id, viewerId })
  return [detail.post, ...replies]
}

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
  const feedPresentationVersion = 16
  const bannerVersion = banner
    ? ['notifications', 'appearance', 'invite', 'bio', 'notification-update', 'donate'].indexOf(banner) + 1
    : 0
  return (base * 100 + feedPresentationVersion * 2 + (user?.show_moderated_content === 1 ? 1 : 0)) * 10
    + bannerVersion
}

function personalizedFeedAfterVisibleReads(data: PersonalizedFeedData, toMe: boolean): PersonalizedFeedData {
  const unreadEventKeys = [...new Set(data.timeline.filter(row => row.unread).map(row => row.event_key))]
  const consumed = unreadEventKeys.length
  const latestConsumed = toMe ? 0 : unreadEventKeys.filter(eventKey => /^post:\d+$/.test(eventKey)).length
  const latestCount = Math.max(0, (data.latestCount || 0) - latestConsumed)
  const consumedRoots = new Set(data.timeline.filter(row => row.unread && row.activity_kind === 'post')
    .map(row => row.id)).size
  return {
    ...data,
    forYouCount: Math.max(0, data.forYouCount - consumed),
    toMeCount: Math.max(0, data.toMeCount - (toMe ? consumed : 0)),
    latestCount,
    newCount: Math.max(0, (data.newCount || 0) - consumedRoots),
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

function newFeedAfterVisibleReads(feed: PostFeedPage): PostFeedPage {
  const consumed = new Set(feed.unreadPostIds || []).size
  return { ...feed, newCount: Math.max(0, (feed.newCount || 0) - consumed), unreadPostIds: [] }
}

const positiveInteger = (value?: string) => {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
const requestedFeedChunk = (c: Context) => feedChunk(c.req.query('_feed_chunk'))
const requestedRestoredChunks = (c: Context) => restoredFeedChunks(c.req.query('chunk'))
const anySeed = (value?: string) => {
  if (!value || !/^[0-9a-z]+$/.test(value)) return undefined
  const parsed = Number.parseInt(value, 36)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < 2_147_483_647 ? parsed : undefined
}
const writeState = async (c: Context) => {
  if (c.req.method === 'POST') {
    const fields = await form(c.req.raw)
    const writeBody = normalizePostBody(fields.body || '')
    if (!['autotag', 'preview'].includes(fields.action || '') || fields.embedded !== '1') {
      return { writeError: 'Unsupported feed action.', writeBody, writeHandled: true }
    }
    if (fields.action === 'autotag') {
      if (!writeBody.trim()) return { writeError: postBodyValidationMessage(writeBody), writeBody, writeHandled: true }
      const result = await autotagText(writeBody)
      const enrichedBody = result.ok ? normalizePostBody(result.body) : writeBody
      const valid = result.ok && validPostBody(enrichedBody)
      return {
        writeBody: valid ? enrichedBody : writeBody,
        writeDraftId: fields.draft_id,
        writeHandled: true,
        writeError: result.ok && !valid
          ? `The message is too big to autotag within the ${POST_MAX}-character limit. Edit it down and try again.`
          : result.ok
          ? undefined
          : result.message,
      }
    }
    if (!validPostBody(writeBody)) {
      return { writeError: postBodyValidationMessage(writeBody), writeBody, writeHandled: true }
    }
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
      writeHandled: true,
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
const recentFeedVisitorLimit = 40
let feedWarmTail = Promise.resolve()
const missWarmGenerations = new Map<number, number>()

const feedVariantCookieNames = new Set([
  'appearance',
  'font',
  'sans-serif-font',
  'primary-font',
  'font-size',
  'corners',
  'notification_device',
  'donation_banner_dismissed',
  'pwa_standalone',
  'pwa_install_banner_dismissed',
])

function feedVariantCookie(request: Request) {
  return (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => {
    const separator = value.indexOf('=')
    return separator > 0 && feedVariantCookieNames.has(value.slice(0, separator))
  }).join('; ')
}

function recentFeedVisitor(request: Request, user: NonNullable<ReturnType<typeof currentUser>>): RecentFeedVisitor {
  const density = resolvedDensity(request)
  const pageSize = resolvedPageSize(request)
  const cookie = feedVariantCookie(request)
  const userAgent = request.headers.get('user-agent') || ''
  const requestUrl = new URL('/all', request.url).href
  return {
    density,
    pageSize,
    user,
    request: new Request(requestUrl, { headers: { cookie, 'user-agent': userAgent } }),
  }
}

function rememberFeedVisitor(request: Request, user: NonNullable<ReturnType<typeof currentUser>> | null) {
  if (!user) return
  const visitor = recentFeedVisitor(request, user)
  const cookie = visitor.request.headers.get('cookie') || ''
  const userAgent = visitor.request.headers.get('user-agent') || ''
  const requestUrl = visitor.request.url
  recentFeedVisitors.delete(user.id)
  recentFeedVisitors.set(user.id, visitor)
  while (recentFeedVisitors.size > recentFeedVisitorLimit) {
    recentFeedVisitors.delete(recentFeedVisitors.keys().next().value!)
  }
  void backgroundDatabaseCall('cache.recentFeedVisitorPut', {
    userId: user.id,
    requestUrl,
    cookie,
    userAgent,
    pageSize: visitor.pageSize,
    density: visitor.density,
  }).catch(error => console.error('Could not remember recent feed visitor', error))
}

async function warmRecentFeedTab(visitor: RecentFeedVisitor, kind: 'latest' | 'new' | 'hot' | 'for-you' | 'to-me') {
  const notificationBanner = await showNotificationBanner(visitor.request, visitor.user)
  await withRequestContext({ sessionUser: visitor.user, apiUser: null, pageSize: visitor.pageSize,
    density: visitor.density }, () =>
    withAppearance(visitor.request, async () => {
      if (kind === 'latest') {
        await rpcMaterializedFeedPage(visitor.request, kind, visitor.user.id, async () => {
          const feed = await backgroundDatabaseCall('feeds.latestPage', { viewerId: visitor.user.id, page: 1,
            pageSize: visitor.pageSize, markRead: false })
          return page(
            <PublicFeed user={visitor.user} feed={feed} path="/all" notificationBanner={notificationBanner} />,
          )
        }, false, viewerCacheVersion(latestFeedCacheVersion, visitor.user, notificationBanner), true)
      }
      else if (kind === 'new' || kind === 'hot') {
        await rpcMaterializedFeedPage(visitor.request, kind, visitor.user.id, async () => {
          const feed = kind === 'new'
            ? await backgroundDatabaseCall('feeds.newPage', { viewerId: visitor.user.id, page: 1,
              pageSize: visitor.pageSize })
            : await backgroundDatabaseCall('feeds.hotPage', { viewerId: visitor.user.id, page: 1,
              pageSize: visitor.pageSize })
          return page(kind === 'new'
            ? <PublicFeed user={visitor.user} feed={feed} path="/new" notificationBanner={notificationBanner} />
            : <HotFeed user={visitor.user} feed={feed} title="hot" notificationBanner={notificationBanner} />)
        }, false,
          viewerCacheVersion(kind === 'new' ? newFeedCacheVersion : hotRankingVersion, visitor.user,
            notificationBanner), true)
      }
      else {
        const toMe = kind === 'to-me'
        await rpcMaterializedFeedPage(visitor.request, kind, visitor.user.id, async () => {
          const data = await backgroundDatabaseCall('feeds.personalizedPage', { user: visitor.user, page: 1,
            pageSize: visitor.pageSize, toMe, path: toMe ? '/@' : '/my-feed', markRead: false })
          return page(
            <Feed user={visitor.user} data={data} title={toMe ? '@' : 'my feed'} path={toMe ? '/@' : undefined}
              toMe={toMe} notificationBanner={notificationBanner} />,
          )
        }, false, viewerCacheVersion(kind === 'for-you' ? 12 : 1, visitor.user, notificationBanner), true)
      }
    }))
}

async function serialWarmFeedTab(visitor: RecentFeedVisitor, kind: Parameters<typeof warmRecentFeedTab>[1],
  waitUntilIdle: () => Promise<void>)
{
  const previous = feedWarmTail
  let release!: () => void
  feedWarmTail = new Promise<void>(resolve => release = resolve)
  await previous.catch(() => undefined)
  try {
    await waitUntilIdle()
    await warmRecentFeedTab(visitor, kind)
  }
  finally {
    release()
  }
}

function warmOtherFeedTabsAfterMiss(request: Request, user: NonNullable<ReturnType<typeof currentUser>> | null,
  current: Parameters<typeof warmRecentFeedTab>[1], response: Response)
{
  if (!user || response.headers.get('x-feed-cache') !== 'miss' || Bun.env.DEV_RELOAD === 'true'
    || Bun.env.DISABLE_FEED_WARMING === 'true') return
  const generation = (missWarmGenerations.get(user.id) || 0) + 1
  missWarmGenerations.set(user.id, generation)
  const visitor = recentFeedVisitor(request, user)
  const tabs = (['latest', 'new', 'hot', 'for-you', 'to-me'] as const).filter(tab => tab !== current)
  void (async () => {
    for (const tab of tabs) {
      await serialWarmFeedTab(visitor, tab, async () => {
        await feedWarmIdle.waitUntilIdle()
        if (missWarmGenerations.get(user.id) !== generation) {
          throw new DOMException('Superseded miss warm', 'AbortError')
        }
      })
    }
  })().catch(error => {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.error('Could not warm other feed tabs after cache miss', error)
    }
  })
}

export async function warmRecentFeedTabs(waitUntilIdle: () => Promise<void>, limit = 40) {
  const visitors = [...recentFeedVisitors.values()].reverse().slice(0, limit)
  const tabs = ['latest', 'new', 'hot', 'for-you', 'to-me'] as const
  for (const visitor of visitors) {
    for (const tab of tabs) {
      await serialWarmFeedTab(visitor, tab, waitUntilIdle)
    }
  }
}

export async function loadRecentFeedVisitors() {
  const visitors = await databaseService().call('cache.recentFeedVisitors', {})
  for (const visitor of visitors) {
    recentFeedVisitors.set(visitor.user.id, {
      user: visitor.user,
      request: new Request(visitor.requestUrl, { headers: {
        cookie: visitor.cookie,
        'user-agent': visitor.userAgent,
      } }),
      pageSize: visitor.pageSize,
      density: visitor.density,
    })
  }
}

export function registerFeedsRoutes(app: Hono) {
  app.get('/feed/counts', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const counts = await databaseService().call('feeds.unreadCounts', { userId: user.id })
    return c.json(counts, 200, { 'cache-control': 'no-store' })
  })

  app.get('/feed/events', c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.text('Unauthorized', 401)
    const encoder = new TextEncoder()
    let cleanup = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let pending = false
        let rerun = false
        let initializing = true
        let queuedDuringInitialization = false
        let lastCounts = ''
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
        const publishCounts = async () => {
          if (pending) {
            rerun = true
            return
          }
          pending = true
          try {
            do {
              rerun = false
              const counts = await databaseService().call('feeds.unreadCounts', { userId: user.id })
              const serialized = JSON.stringify(counts)
              if (serialized !== lastCounts) {
                lastCounts = serialized
                send(`event: feed\ndata: ${serialized}\n\n`)
              }
            }
            while (rerun && !closed)
          }
          catch {
            close()
          }
          finally {
            pending = false
          }
        }
        unsubscribe = subscribeToPosts(() => {
          if (initializing) queuedDuringInitialization = true
          else void publishCounts()
        })
        void databaseService().call('feeds.unreadCounts', { userId: user.id }).then(counts => {
          lastCounts = JSON.stringify(counts)
          send(`event: baseline\ndata: ${lastCounts}\n\n`)
          initializing = false
          if (queuedDuringInitialization) void publishCounts()
        }).catch(close)
        heartbeat = setInterval(() => {
          send(': heartbeat\n\n')
          if (initializing) queuedDuringInitialization = true
          else void publishCounts()
        }, SSE_HEARTBEAT_MS)
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
        : c.req.query('hn') !== undefined
        ? 'hn'
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
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user.id)
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const pageSize = resolvedPageSize(c.req.raw)
    const liveRefresh = c.req.header('X-Textlog-Live-Refresh') === '1'
    const explicitRead = c.req.header('X-Textlog-Explicit-Read') === '1'
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () => {
      if (!dataPromise) {
        dataPromise = databaseService().call('feeds.personalizedPage', {
          user,
          page: currentPage(c.req.query('page')),
          pageSize,
          toMe: false,
          path: '/my-feed',
          markRead: !liveRefresh,
        })
      }
      return dataPromise
    }
    const render = async () => {
      let feed = await data()
      if (liveRefresh) {
        const consumedRoots = new Set(feed.timeline.filter(row => row.unread && row.activity_kind === 'post')
          .map(row => row.id)).size
        const postIds = [
          ...new Set(
            feed.timeline.filter(row => ['post', 'reply', 'mention'].includes(row.activity_kind)).map(row => row.id),
          ),
        ]
        const consumed = postIds.length
          ? await databaseService().call('api.markLatestRead', { userId: user.id, postIds })
          : 0
        if (consumed) feed = { ...feed,
          latestCount: Math.max(0, (feed.latestCount || 0) - consumed),
          newCount: Math.max(0, (feed.newCount || 0) - consumedRoots) }
      }
      const view = (
        <Feed user={user} data={explicitRead ? personalizedFeedAfterVisibleReads(feed, false) : feed} title="my feed"
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} fetchedThread={fetchedThread}
          chunk={chunk} initialChunks={initialChunks} {...write} />
      )
      return chunk > 0 ? htmlFragment(view) : page(view)
    }
    const renderForCache = async () => {
      const feed = personalizedFeedAfterVisibleReads(await data(), false)
      return page(
        <Feed user={user} data={feed} title="my feed" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} />,
      )
    }
    const response = !liveRefresh && !write.writeHandled && !write.writeError && !write.writePreview
        && chunk === 0 && initialChunks === 1 && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId
        && !fetchedThread
      ? await rpcMaterializedFeedPage(c.req.raw, 'for-you', user.id, render, false,
        viewerCacheVersion(12, user, notificationBanner), false, renderForCache, async () => {
        return await databaseService().call('feeds.markPersonalizedSnapshotPageRead', { userId: user.id, pageSize,
          toMe: false }) > 0
      })
      : await render()
    warmOtherFeedTabsAfterMiss(c.req.raw, user, 'for-you', response)
    const remembered = rememberFeed(response, 'following')
    return remembered
  })

  app.on(['GET', 'POST'], '/all', async c => {
    const user = currentUser(c.req.raw)
    const write = await writeState(c)
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user?.id ?? -1)
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const liveRefresh = c.req.header('X-Textlog-Live-Refresh') === '1'
    const explicitRead = c.req.header('X-Textlog-Explicit-Read') === '1'
    let dataPromise: Promise<PostFeedPage> | undefined
    const data = () =>
      dataPromise ||= databaseService().call('feeds.latestPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw), markRead: !liveRefresh })
    const render = async () => {
      const feed = await data()
      const view = (
        <PublicFeed user={user} feed={explicitRead ? latestFeedAfterVisibleReads(feed) : feed} path="/all"
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} fetchedThread={fetchedThread}
          chunk={chunk} initialChunks={initialChunks} {...write} />
      )
      return chunk > 0 ? htmlFragment(view) : page(view)
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
    const response = !liveRefresh && !write.writeHandled && !write.writeError && !write.writePreview
        && chunk === 0 && initialChunks === 1 && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId
        && !fetchedThread
      ? await rpcMaterializedFeedPage(c.req.raw, 'latest', user ? user.id : -1, render, false,
        viewerCacheVersion(latestFeedCacheVersion, user, notificationBanner), false, renderForCache, user
        ? async () => ((await data()).unreadPostIds?.length || 0) > 0
        : undefined)
      : await render()
    warmOtherFeedTabsAfterMiss(c.req.raw, user, 'latest', response)
    const remembered = rememberFeed(response, 'latest')
    return remembered
  })

  app.on(['GET', 'POST'], '/any', async c => {
    const user = currentUser(c.req.raw)
    rememberFeedVisitor(c.req.raw, user)
    const write = await writeState(c)
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user?.id ?? -1)
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
    const view = (
      <PublicFeed user={user} feed={feed} path={`/any?seed=${seed.toString(36)}`}
        notificationBanner={notificationBanner} expandedRootId={expandedRootId} chunk={chunk}
        fetchedThread={fetchedThread} initialChunks={initialChunks} {...write} />
    )
    const response = rememberFeed(chunk > 0 ? htmlFragment(view) : page(view), 'random')
    response.headers.append('set-cookie', retainedAnyFeedSeedCookie(seed))
    return response
  })

  app.on(['GET', 'POST'], '/new', async c => {
    const user = currentUser(c.req.raw)
    rememberFeedVisitor(c.req.raw, user)
    const write = await writeState(c)
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user?.id ?? -1)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const liveRefresh = c.req.header('X-Textlog-Live-Refresh') === '1'
    const explicitRead = c.req.header('X-Textlog-Explicit-Read') === '1'
    let dataPromise: Promise<PostFeedPage> | undefined
    const data = () => dataPromise ||= databaseService().call('feeds.newPage', {
      viewerId: user?.id ?? -1,
      page: currentPage(c.req.query('page')),
      pageSize: resolvedPageSize(c.req.raw),
      markRead: !liveRefresh,
    })
    const render = async () => {
      const feed = await data()
      const view = (
        <PublicFeed user={user} feed={explicitRead ? newFeedAfterVisibleReads(feed) : feed} path="/new"
          notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} fetchedThread={fetchedThread} chunk={chunk} initialChunks={initialChunks}
          {...write} />
      )
      return chunk > 0 ? htmlFragment(view) : page(view)
    }
    const renderForCache = user
      ? async () => page(<PublicFeed user={user} feed={newFeedAfterVisibleReads(await data())} path="/new"
        notificationBanner={notificationBanner} expandedRootId={expandedRootId} />)
      : undefined
    const response = !liveRefresh && !write.writeHandled && !write.writeError && !write.writePreview
        && chunk === 0 && initialChunks === 1 && currentPage(c.req.query('page')) === 1 && !expandedRootId
        && !fetchedThread
      ? await rpcMaterializedFeedPage(c.req.raw, 'new', user?.id ?? -1, render, false,
        viewerCacheVersion(newFeedCacheVersion, user, notificationBanner), false, renderForCache, user
        ? async () => ((await data()).unreadPostIds?.length || 0) > 0
        : undefined)
      : await render()
    warmOtherFeedTabsAfterMiss(c.req.raw, user, 'new', response)
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
    rememberFeedVisitor(c.req.raw, user)
    const write = await writeState(c)
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user.id)
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const pageSize = resolvedPageSize(c.req.raw)
    const liveRefresh = c.req.header('X-Textlog-Live-Refresh') === '1'
    const explicitRead = c.req.header('X-Textlog-Explicit-Read') === '1'
    let dataPromise: Promise<PersonalizedFeedData> | undefined
    const data = () =>
      dataPromise ||= databaseService().call('feeds.personalizedPage', {
        user,
        page: currentPage(c.req.query('page')),
        pageSize,
        toMe: true,
        path: '/@',
        markRead: !liveRefresh,
      })
    const render = async () => {
      const feed = await data()
      const view = (
        <Feed user={user} data={explicitRead ? personalizedFeedAfterVisibleReads(feed, true) : feed} title="@" path="/@"
          toMe notificationBanner={notificationBanner} expandedRootId={expandedRootId} fetchedThread={fetchedThread}
          chunk={chunk} initialChunks={initialChunks} {...write} />
      )
      return chunk > 0 ? htmlFragment(view) : page(view)
    }
    const renderForCache = async () => {
      const feed = await data()
      return page(
        <Feed user={user} data={personalizedFeedAfterVisibleReads(feed, true)} title="@" path="/@" toMe
          notificationBanner={notificationBanner} expandedRootId={expandedRootId} />,
      )
    }
    const response = !liveRefresh && !write.writeHandled && !write.writeError && !write.writePreview
        && chunk === 0 && initialChunks === 1 && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId
        && !fetchedThread
      ? await rpcMaterializedFeedPage(c.req.raw, 'to-me', user.id, render, false,
        viewerCacheVersion(1, user, notificationBanner), false, renderForCache, async () => {
        return await databaseService().call('feeds.markPersonalizedSnapshotPageRead', { userId: user.id, pageSize,
          toMe: true }) > 0
      })
      : await render()
    warmOtherFeedTabsAfterMiss(c.req.raw, user, 'to-me', response)
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
    const chunk = requestedFeedChunk(c)
    if (chunk === null || chunk > 0 && c.req.method !== 'GET') return c.text('Invalid feed chunk', 400)
    const initialChunks = requestedRestoredChunks(c)
    if (initialChunks === null) return c.text('Invalid restored feed chunk', 400)
    rememberFeedVisitor(c.req.raw, user)
    const cursorValue = c.req.query('cursor')
    const expandedRootId = positiveInteger(c.req.query('expand'))
    const fetchedThread = await requestedFetchedThread(c, user?.id ?? -1)
    if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = await showNotificationBanner(c.req.raw, user)
    const render = async () => {
      const feed = await databaseService().call('feeds.hotPage', { viewerId: user?.id ?? -1,
        page: currentPage(c.req.query('page')), pageSize: resolvedPageSize(c.req.raw) })
      const view = (
        <HotFeed user={user} feed={feed} title="hot" notificationBanner={notificationBanner}
          expandedRootId={expandedRootId} fetchedThread={fetchedThread} chunk={chunk} initialChunks={initialChunks}
          {...write} />
      )
      return chunk > 0 ? htmlFragment(view) : page(view)
    }
    const response = chunk === 0 && initialChunks === 1
        && !write.writeHandled && !write.writeError && !write.writePreview
        && currentPage(c.req.query('page')) === 1 && !cursorValue
        && !expandedRootId && !fetchedThread
      ? await rpcMaterializedFeedPage(c.req.raw, 'hot', user?.id ?? -1, render, false,
        viewerCacheVersion(hotRankingVersion, user, notificationBanner))
      : await render()
    warmOtherFeedTabsAfterMiss(c.req.raw, user, 'hot', response)
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
    const response = user
      ? page(<About user={user} />)
      : await rpcMaterializedFeedPage(c.req.raw, 'about', -1, async () => page(<About user={null} />))
    if (!user && c.req.query('hn') !== undefined) {
      response.headers.append('set-cookie', campaignAttributionCookie('hn'))
    }
    return response
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
