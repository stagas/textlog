import { applyHtmlCachePolicy, campaignAttribution, canonicalizeCrawlerLinks, crawlerCanonicalRedirect,
  GLOBAL_REQUEST_BODY_LIMIT, isCrawlerRequest, isSameOriginRequest, limitedFormData, pwaStandaloneCookie,
  RequestBodyError, requiresSameOrigin, safeLocalPath, securityHeaders } from './http'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { BACKUP_CHECK_INTERVAL_MS } from './backup-automation'
import { appName, clientIpHeaderName } from './brand'
import { BlogBuildingWithoutJavascript } from './components/blog-building-without-javascript'
import { BlogRecap } from './components/blog-recap'
import { BlogRecapV2 } from './components/blog-recap-v2'
import { configureDevReload } from './components/layout'
import { MOOD_CHOICES, MoodPicker, shouldShowMoodPicker } from './components/mood-picker'
import { NavigationCaptcha } from './components/navigation-captcha'
import { PanelsGallery } from './components/panels-gallery'
import { PeoplePicker, shouldShowPeoplePicker } from './components/people-picker'
import { shouldShowTagPicker, TagPicker } from './components/tag-picker'
import { compressResponse } from './compression'
import { databaseService, subscribeToFeedMutations } from './database-service'
import { isDevelopment } from './environment'
import { localImageFile, usesLocalImageStorage } from './image-storage'
import { campaignIpPseudonym } from './ip-privacy'
import { clientIp, logError, logHttp, logReady, redactHttpPath, shouldLogHttp } from './log'
import { MAINTENANCE_INTERVAL_MS } from './maintenance'
import { NavigationCaptchaChallenges, NavigationCaptchaGate, NESTED_FROM_MAX_DEPTH,
  nestedFromDepth } from './navigation-captcha'
import { renderDefaultOg } from './og'
import { PUBLIC_ARCHIVE_CHECK_INTERVAL_MS } from './public-archive'
import { sendPushForFollow, sendPushForUserFollow, startPostPushWorker } from './push'
import { resumeRelationshipFeedInvalidation,
  scheduleRelationshipFeedInvalidation } from './relationship-feed-invalidation'
import { allowNavigationCaptcha, flushIpRequests, isIpBlocked, isNavigationCaptchaAllowed, loadBlockedIps,
  recordIpRequest } from './request-ip-blocks'
import { ClientErrorRateLimiter, HOURLY_REQUEST_BLOCK_SECONDS, HOURLY_REQUEST_RATE_LIMIT,
  HOURLY_REQUEST_RATE_WINDOW_SECONDS, rateLimitedResponse, RequestRateLimiter } from './request-rate-limit'
import { registerAccountRoutes } from './routes/account'
import { registerAdminRoutes } from './routes/admin'
import { registerApiRoutes } from './routes/api'
import { registerAuthRoutes } from './routes/auth'
import { registerBookmarksRoutes } from './routes/bookmarks'
import { registerEmbedRoutes } from './routes/embed'
import { loadRecentFeedVisitors, registerFeedsRoutes, warmNextRecentLatestFeed,
  warmRecentLatestFeeds } from './routes/feeds'
import { registerIllegalActivityRoutes } from './routes/illegal-activity'
import { registerInteractionsRoutes } from './routes/interactions'
import { registerMediaRoutes } from './routes/media'
import { registerPostsRoutes } from './routes/posts'
import { registerProfilesRoutes } from './routes/profiles'
import { registerSearchRoutes } from './routes/search'
import { registerSeoRoutes } from './routes/seo'
import { clientErrorPage, notFoundPage, page, rateLimitPage, serverErrorPage } from './routes/shared'
import { registerStatsRoutes } from './routes/stats'
import { registerTagsRoutes } from './routes/tags'
import { DatabaseUnavailableError } from './runtime-worker-client'
import { loadStylesAsset, stylesResponse } from './styles'
import { themeLogoSvg, themeStyles, versionedAppearance, withAppearance } from './theme'
import { withTimezone } from './timezone'
import { apiUser, currentUser } from './utils'
import { DailyVisitorAllowlist, shouldRecordVisitor, VISITOR_FLUSH_BATCH_SIZE, visitorHash } from './visitors'

const devReloadEnabled = Bun.env.DEV_RELOAD === 'true'
const publicArchivePath = Bun.env.PUBLIC_ARCHIVE_PATH || 'public/dump.zip'
const bootId = crypto.randomUUID()
configureDevReload(devReloadEnabled ? bootId : undefined)
const app = new Hono()
const publicEmailPreferencePaths = new Set([
  '/account/recap-emails/unsubscribe',
  '/account/interacted-emails/unsubscribe',
])
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if ((c.req.method === 'GET' || c.req.method === 'HEAD') && url.pathname === '/'
    && url.searchParams.has('pwa'))
  {
    url.searchParams.delete('pwa')
    return new Response(null, { status: 303, headers: {
      location: url.pathname + url.search + url.hash,
      'set-cookie': pwaStandaloneCookie(),
    } })
  }
  if ((c.req.method === 'GET' || c.req.method === 'HEAD') && url.searchParams.get('_scroll') === 'instant') {
    url.searchParams.delete('_scroll')
    const location = url.pathname + url.search + url.hash
    return new Response(null, { status: 303, headers: {
      location,
      'set-cookie': 'textlog_scroll=instant; Max-Age=10; HttpOnly; Path=/; SameSite=Lax',
    } })
  }
  await next()
  if (/(?:^|;\s*)textlog_scroll=instant(?:;|$)/.test(c.req.header('cookie') || '')
    && c.res.headers.get('content-type')?.includes('text/html'))
  {
    c.header('set-cookie', 'textlog_scroll=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax', { append: true })
  }
})
app.use('*', (c, next) => withAppearance(c.req.raw, next))
app.use('*', (c, next) => {
  const user = currentUser(c.req.raw)
  return withTimezone(user?.timezone || undefined, next)
})
const stylesPath = new URL('./styles.css', import.meta.url).pathname
const styles = devReloadEnabled ? undefined : await loadStylesAsset(stylesPath)
const publicAssets = await Promise.all([
  ['/favicon.ico', 'image/x-icon'],
  ['/favicon-16x16.png', 'image/png'],
  ['/favicon-32x32.png', 'image/png'],
  ['/apple-touch-icon.png', 'image/png'],
  ['/android-chrome-192x192.png', 'image/png'],
  ['/android-chrome-512x512.png', 'image/png'],
  ['/maskable-icon-512x512.png', 'image/png'],
  ['/email-logo.png', 'image/png'],
].map(async ([path, contentType]) => ({
  path,
  contentType,
  body: await Bun.file(new URL(`../public${path}`, import.meta.url)).arrayBuffer(),
})))
const defaultOgImage = renderDefaultOg()
const defaultOgBody = defaultOgImage.buffer.slice(
  defaultOgImage.byteOffset,
  defaultOgImage.byteOffset + defaultOgImage.byteLength,
) as ArrayBuffer
const pendingVisitors = new Map<string, { day: string; hash: string; anonymousLastSeenAt: number | null }>()
const dailyVisitorAllowlist = new DailyVisitorAllowlist()
let visitorFlushRunning = false
function recordVisitor(address: string, visitedAt = new Date(), anonymous = true) {
  if (!address || address === '-') return
  const day = visitedAt.toISOString().slice(0, 10)
  const hash = visitorHash(address, visitedAt)
  const key = `${day}:${hash}`
  const pending = pendingVisitors.get(key)
  pendingVisitors.set(key, { day, hash, anonymousLastSeenAt: anonymous
    ? Math.max(pending?.anonymousLastSeenAt || 0, visitedAt.getTime())
    : pending?.anonymousLastSeenAt || null })
  if (pendingVisitors.size >= VISITOR_FLUSH_BATCH_SIZE) {
    void flushVisitors().catch(error => logError('visitor buffer flush failed', error))
  }
}
async function flushVisitors() {
  if (visitorFlushRunning) return
  const visits = [...pendingVisitors.values()].slice(0, VISITOR_FLUSH_BATCH_SIZE)
  if (!visits.length) return
  visitorFlushRunning = true
  try {
    await databaseService().call('maintenance.flushVisitors', { visits })
    for (const visit of visits) {
      const key = `${visit.day}:${visit.hash}`
      // Keep a newer observation that arrived while this batch was in flight.
      if (pendingVisitors.get(key) === visit) pendingVisitors.delete(key)
    }
  }
  finally {
    visitorFlushRunning = false
  }
}
const requestRateLimiter = new RequestRateLimiter()
const hourlyRequestRateLimiter = new RequestRateLimiter({
  limit: HOURLY_REQUEST_RATE_LIMIT,
  windowSeconds: HOURLY_REQUEST_RATE_WINDOW_SECONDS,
  blockSeconds: HOURLY_REQUEST_BLOCK_SECONDS,
})
const clientErrorRateLimiter = new ClientErrorRateLimiter()
const navigationCaptchaChallenges = new NavigationCaptchaChallenges()
const navigationCaptchaGate = new NavigationCaptchaGate()
await loadBlockedIps()
startPostPushWorker()
await loadRecentFeedVisitors()
let publicationWarmScheduled = false
subscribeToFeedMutations(operation => {
  if (Bun.env.DISABLE_FEED_WARMING === 'true') return
  if (!['api.createPost', 'api.publishDraft', 'api.updatePost', 'api.deletePost', 'api.unpublishPost', 'posts.votePoll']
    .includes(operation) || publicationWarmScheduled) return
  publicationWarmScheduled = true
  setTimeout(() => {
    publicationWarmScheduled = false
    void warmRecentLatestFeeds().catch(error => logError('write-through latest feed warm failed', error))
  }, 50)
})
let hotProjectionRefreshRunning = false
const hotProjectionWorker = new Worker(new URL('./hot-projection-worker.ts', import.meta.url))
let finishInitialHotProjection: (() => void) | undefined
const initialHotProjection = new Promise<void>(resolve => {
  finishInitialHotProjection = resolve
})
hotProjectionWorker.onmessage = async event => {
  hotProjectionRefreshRunning = false
  const result = event.data as { refreshed?: boolean; error?: string }
  if (result.error) {
    logError('hot feed projection refresh failed', new Error(result.error))
    finishInitialHotProjection?.()
    finishInitialHotProjection = undefined
    return
  }
  if (result.refreshed) {
    await databaseService().call('feeds.hotProjectionChanged', {})
      .catch(error => logError('hot feed cache invalidation failed', error))
  }
  finishInitialHotProjection?.()
  finishInitialHotProjection = undefined
}
hotProjectionWorker.onerror = event => {
  hotProjectionRefreshRunning = false
  finishInitialHotProjection?.()
  finishInitialHotProjection = undefined
  logError('hot feed projection worker failed', new Error(event.message))
}
const refreshHotProjection = () => {
  if (hotProjectionRefreshRunning) return
  hotProjectionRefreshRunning = true
  hotProjectionWorker.postMessage({ now: new Date().toISOString() })
}
refreshHotProjection()
await initialHotProjection
const hotProjectionTimer = setInterval(refreshHotProjection, 30_000)
hotProjectionTimer.unref()
const recentLatestWarmTimer = setInterval(() => {
  if (Bun.env.DISABLE_FEED_WARMING !== 'true') {
    void warmNextRecentLatestFeed().catch(error => logError('recent latest feed warm failed', error))
  }
}, 2_000)
recentLatestWarmTimer.unref()
const ipRequestTimer = setInterval(
  () => void flushIpRequests().catch(error => logError('IP request buffer flush failed', error)),
  5_000,
)
ipRequestTimer.unref()
function requestRateLimitResponse(request: Request, retryAfter: number) {
  const acceptsHtml = request.headers.get('accept')?.includes('text/html')
  return acceptsHtml && !new URL(request.url).pathname.startsWith('/api/')
    ? rateLimitPage(request, retryAfter)
    : rateLimitedResponse(retryAfter)
}
let cleanupRunning = false
const runCleanup = async () => {
  if (cleanupRunning) return
  cleanupRunning = true
  try {
    await databaseService().call('maintenance.cleanup', { now: Date.now() })
  }
  catch (error) {
    logError('database maintenance failed', error)
  }
  finally {
    cleanupRunning = false
  }
}
void runCleanup()
const visitorTimer = setInterval(
  () => void flushVisitors().catch(error => logError('visitor buffer flush failed', error)),
  5_000,
)
const cleanupTimer = setInterval(runCleanup, MAINTENANCE_INTERVAL_MS)
visitorTimer.unref()
cleanupTimer.unref()
if (Bun.env.NODE_ENV === 'production') {
  const backupDirectory = Bun.env.DATABASE_BACKUP_DIR || 'storage/backups'
  const bootBackup = await databaseService().call('maintenance.bootBackup', { directory: backupDirectory })
  console.log(`database boot backup  ${bootBackup}`)
  let backupRunning = false
  const runBackup = async () => {
    if (backupRunning) return
    backupRunning = true
    try {
      await databaseService().call('maintenance.automatedBackup', {
        directory: backupDirectory,
        now: new Date().toISOString(),
      })
    }
    catch (error) {
      logError('automated backup failed', error)
      if (Bun.env.BACKUP_ALERT_WEBHOOK_URL) {
        await fetch(Bun.env.BACKUP_ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ event: 'database_backup_failed', service: 'textlog', error: String(error),
            occurredAt: new Date().toISOString() }) }).catch(alertError =>
            logError('backup alert delivery failed', alertError))
      }
    }
    finally {
      backupRunning = false
    }
  }
  let archiveRunning = false
  const runArchive = async () => {
    if (archiveRunning) return
    archiveRunning = true
    try {
      const result = await databaseService().call('maintenance.publicArchive', {
        path: publicArchivePath,
        now: new Date().toISOString(),
      })
      if (result && typeof result === 'object' && 'path' in result) console.log(`public archive    ${result.path}`)
    }
    catch (error) {
      logError('public archive generation failed', error)
    }
    finally {
      archiveRunning = false
    }
  }
  void runBackup()
  void runArchive()
  const backupTimer = setInterval(runBackup, BACKUP_CHECK_INTERVAL_MS)
  const archiveTimer = setInterval(runArchive, PUBLIC_ARCHIVE_CHECK_INTERVAL_MS)
  backupTimer.unref()
  archiveTimer.unref()
}

app.use('*', bodyLimit({
  maxSize: GLOBAL_REQUEST_BODY_LIMIT,
  onError: c => clientErrorPage(c.req.raw, 413),
}))

app.use('*', async (c, next) => {
  await next()
  if (c.res.status < 400 || c.res.status >= 500 || c.req.method !== 'GET') return
  if (!c.req.header('accept')?.includes('text/html')) return
  if (!c.res.headers.get('content-type')?.includes('text/plain')) return
  c.res = clientErrorPage(c.req.raw, c.res.status)
})

app.use('*', async (c, next) => {
  await next()
  if (!shouldRecordVisitor(c.req.method, c.req.path, c.res.status)) return
  try {
    const visitedAt = new Date()
    const address = c.req.header(clientIpHeaderName()) || '-'
    dailyVisitorAllowlist.add(address, visitedAt)
    recordVisitor(address, visitedAt, !currentUser(c.req.raw))
    const campaign = campaignAttribution(c.req.raw)
    if (campaign === 'reddit') {
      const campaignVisitorHash = campaignIpPseudonym(address, campaign)
      if (campaignVisitorHash !== '-') {
        await databaseService().call('stats.recordCampaignVisitor', { campaign, visitorHash: campaignVisitorHash })
      }
    }
  }
  catch (error) {
    logError('visitor buffer flush failed', error)
  }
})

app.use('*', async (c, next) => {
  const started = performance.now()
  const username = (currentUser(c.req.raw) || (c.req.path.startsWith('/api/') ? apiUser(c.req.raw) : null))?.handle
  try {
    await next()
  }
  finally {
    const url = new URL(c.req.url)
    const path = url.pathname
    const address = c.req.header(clientIpHeaderName()) || '-'
    const campaign = url.searchParams.has('reddit') || campaignAttribution(c.req.raw) === 'reddit'
    if (shouldLogHttp(path, c.res.status, isCrawlerRequest(c.req.raw), Boolean(username), campaign,
      dailyVisitorAllowlist.has(address)))
    {
      logHttp(c.req.method, redactHttpPath(`${path}${url.search}`), c.res.status, performance.now() - started, address,
        username, c.req.header('user-agent') || '-', c.res.headers.get('x-feed-cache'))
    }
  }
})

app.use('*', async (c, next) => {
  await next()
  c.res = await compressResponse(c.req.raw, c.res)
})

app.use('*', async (c, next) => {
  const redirect = crawlerCanonicalRedirect(c.req.raw)
  if (redirect) return redirect
  await next()
  c.res = await canonicalizeCrawlerLinks(c.req.raw, c.res)
})

app.use('*', async (c, next) => {
  await next()
  const embeddable = c.req.path.startsWith('/embed/')
  const notificationSettings = c.req.path === '/account/edit/notifications'
  for (const [name, value] of Object.entries(
    securityHeaders(devReloadEnabled, undefined, embeddable, notificationSettings),
  )) c.header(name, value)
  if (c.req.path === '/textlog.svg' || c.req.path === '/favicon-theme.svg') {
    c.header('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'')
  }
})
app.use('*', async (c, next) => {
  await next()
  if (!c.res.headers.get('content-type')?.includes('text/html')) return
  applyHtmlCachePolicy(c.req.raw, c.res)
})
app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || !c.res.headers.get('content-type')?.includes('text/html')) return
  const url = new URL(c.req.url)
  const privatePath =
    /^\/(?:enter|forgot-password|reset-password|choose-handle|navigation-check|write|compose|pending-post|pending-follow|activity|admin|search|account|panels-gallery|recap-email(?:-v2)?|interacted-email)(?:\/|$)/
      .test(url.pathname) || /^\/post\/\d+\/(?:edit|delete)$/.test(url.pathname)
  const transientParameters = ['reply', 'back', 'report', 'reported', 'edit', 'reset', 'token']
  const navigationOnly = url.searchParams.has('from')
  const transient = transientParameters.some(name => url.searchParams.has(name))
  if (navigationOnly) c.header('X-Robots-Tag', 'noindex, follow')
  else if (privatePath || transient || c.res.status >= 400) c.header('X-Robots-Tag', 'noindex, nofollow')
  if (!privatePath && c.res.status < 400) {
    for (const name of transientParameters) url.searchParams.delete(name)
    url.searchParams.delete('from')
    if (url.searchParams.get('page') === '1') url.searchParams.delete('page')
    const configuredOrigin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : url.origin
    c.header('Link', `<${configuredOrigin + url.pathname + url.search}>; rel="canonical"`)
  }
})
app.use('*', async (c, next) => {
  if (requiresSameOrigin(c.req.method, c.req.path) && !isSameOriginRequest(c.req.raw)) {
    return c.text('Forbidden', 403)
  }
  await next()
})
app.use('*', async (c, next) => {
  if (c.req.method !== 'POST' || ['/enter', '/choose-handle', '/logout'].includes(c.req.path)
    || publicEmailPreferencePaths.has(c.req.path)) return next()
  const user = currentUser(c.req.raw)
  if (user && !user.handle_chosen_at) {
    const referer = c.req.header('referer')
    const fallback = referer && new URL(referer).origin === new URL(c.req.url).origin
      ? safeLocalPath(new URL(referer).pathname + new URL(referer).search)
      : '/'
    return c.redirect('/choose-handle?next=' + encodeURIComponent(fallback), 303)
  }
  await next()
})
app.use('*', async (c, next) => {
  const user = currentUser(c.req.raw)
  const wantsHtml = c.req.header('accept')?.includes('text/html')
  if (c.req.method === 'GET' && wantsHtml && user && !user.handle_chosen_at
    && c.req.path !== '/choose-handle' && !c.req.path.startsWith('/enter')
    && !publicEmailPreferencePaths.has(c.req.path))
  {
    const url = new URL(c.req.url)
    const nextPath = safeLocalPath(url.pathname + url.search)
    return c.redirect('/choose-handle?next=' + encodeURIComponent(nextPath), 303)
  }
  if (c.req.method !== 'GET' || !wantsHtml
    || ['/choose-handle', '/pending-post', '/pending-follow'].includes(c.req.path)) return next()
  const url = new URL(c.req.url)
  const postPage = /^\/post\/[1-9]\d*$/.test(url.pathname)
  const targetPostId = /^[1-9]\d*$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : null
  const returnTo = safeLocalPath(url.pathname + url.search
    + (postPage && targetPostId ? `#post-${targetPostId}` : ''))
  if (user && shouldShowMoodPicker(user)) return page(<MoodPicker user={user} returnTo={returnTo} />)
  if (user && shouldShowTagPicker(user)) {
    const tags = await databaseService().call('account.popularTags', { limit: 12 })
    return page(<TagPicker user={user} tags={tags} returnTo={returnTo} />)
  }
  if (user && shouldShowPeoplePicker(user)) {
    const people = await databaseService().call('account.popularPeople', { userId: user.id, limit: 12 })
    return page(<PeoplePicker user={user} people={people} returnTo={returnTo} />)
  }
  return next()
})
app.post('/pick-mood', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 4_000)
  const mood = String(fields.get('mood') || '')
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  if (!(MOOD_CHOICES as readonly string[]).includes(mood)) return c.text('Invalid mood', 400)
  await databaseService().call('account.answerMoodPrompt', { userId: user.id, mood })
  return c.redirect(returnTo, 303)
})
app.post('/pick-mood/dismiss', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 4_000)
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  await databaseService().call('account.answerMoodPrompt', { userId: user.id, mood: null })
  return c.redirect(returnTo, 303)
})
app.post('/pick-tags', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 8_000)
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  const popularTags = await databaseService().call('account.popularTags', { limit: 12 })
  const allowed = new Set(popularTags.map(tag => tag.tag))
  const tags = [...new Set(fields.getAll('tags').map(String))].filter(tag => allowed.has(tag))
  if (!tags.length && popularTags.length) {
    return page(
      <TagPicker user={user} tags={popularTags} returnTo={returnTo} error="Choose at least one tag to continue." />,
      400,
    )
  }
  await databaseService().call('account.completeTagPrompt', { userId: user.id, tags })
  scheduleRelationshipFeedInvalidation()
  return c.redirect(returnTo, 303)
})
app.post('/pick-tags/dismiss', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 4_000)
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  await databaseService().call('account.completeTagPrompt', { userId: user.id, tags: [] })
  return c.redirect(returnTo, 303)
})
app.post('/pick-people', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 8_000)
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  const popularPeople = await databaseService().call('account.popularPeople', { userId: user.id, limit: 12 })
  const allowed = new Set(popularPeople.map(person => person.id))
  const people = [...new Set(fields.getAll('people').map(Number))].filter(id => allowed.has(id))
  if (!people.length && popularPeople.length) {
    return page(
      <PeoplePicker user={user} people={popularPeople} returnTo={returnTo}
        error="Choose at least one person to continue." />,
      400,
    )
  }
  const result = await databaseService().call('account.completePeoplePrompt', { userId: user.id, people })
  scheduleRelationshipFeedInvalidation()
  for (const followed of result.followed) {
    void sendPushForFollow(user.id, user.handle, followed.id)
      .catch(error => logError('follow push failed', error))
    void sendPushForUserFollow(user.id, user.handle, followed.id, followed.handle)
      .catch(error => logError('follow activity push failed', error))
  }
  return c.redirect(returnTo, 303)
})
app.post('/pick-people/dismiss', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return c.redirect('/enter', 303)
  const fields = await limitedFormData(c.req.raw, 4_000)
  const returnTo = safeLocalPath(String(fields.get('returnTo') || '/'))
  await databaseService().call('account.completePeoplePrompt', { userId: user.id, people: [] })
  return c.redirect(returnTo, 303)
})
app.get('/health', async c => {
  try {
    const database = await databaseService().call('system.health', {
      databasePath: Bun.env.DATABASE_PATH || 'storage/textlog.sqlite',
    })
    if (database.writeLockLatencyMs >= 250 || database.walBytes >= 64 * 1024 * 1024) {
      console.warn('database health warning', {
        writeLockLatencyMs: database.writeLockLatencyMs,
        walBytes: database.walBytes,
      })
    }
    return c.json({ status: 'ok', database }, 200, { 'cache-control': 'no-store' })
  }
  catch (error) {
    logError('health check failed', error)
    return c.json({ status: 'unavailable' }, 503, { 'cache-control': 'no-store' })
  }
})
app.get('/dump.zip', async c => {
  const archive = Bun.file(publicArchivePath)
  if (!await archive.exists()) return c.text('Archive is not available yet', 404)
  return new Response(archive, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="dump.zip"',
      'cache-control': 'public, max-age=3600, must-revalidate',
      'x-content-type-options': 'nosniff',
    },
  })
})
if (devReloadEnabled) {
  app.get('/__dev/restart', c => c.json({ bootId }, 200, { 'cache-control': 'no-store, no-cache, must-revalidate' }))
}
for (const asset of publicAssets) {
  app.get(asset.path, () =>
    new Response(asset.body, {
      headers: {
        'content-type': asset.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    }))
}
if (usesLocalImageStorage()) {
  app.get('/uploads/*', async c => {
    try {
      const key = c.req.path.slice('/uploads/'.length)
      const file = await localImageFile(key)
      if (!file) return c.text('Not found', 404)
      return new Response(file, { headers: {
        'content-type': file.type || 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      } })
    }
    catch {
      return c.text('Not found', 404)
    }
  })
}
app.get('/site.webmanifest', c =>
  c.json({
    name: appName(),
    short_name: appName(),
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    theme_color: '#e5e8e1',
    background_color: '#171a17',
    display: 'standalone',
    start_url: '/?pwa',
  }, 200, { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' }))
app.get('/styles.css', async c => {
  const asset = styles ?? await loadStylesAsset(stylesPath)
  return stylesResponse(asset, c.req.raw, !devReloadEnabled)
})
const embedStyles = await Bun.file(new URL('./embed.css', import.meta.url)).text()
app.get('/embed.css', () =>
  new Response(embedStyles, { headers: {
    'content-type': 'text/css; charset=utf-8',
    'cache-control': 'public, max-age=86400',
  } }))
for (const path of ['/notifications.js', '/sw.js']) {
  const assetUrl = new URL(`../public${path}`, import.meta.url)
  const body = devReloadEnabled ? undefined : await Bun.file(assetUrl).text()
  app.get(path, async () =>
    new Response(
      (body ?? await Bun.file(assetUrl).text()).replaceAll('__APP_NAME__', appName()),
      { headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
        ...(path === '/sw.js' ? { 'service-worker-allowed': '/' } : {}),
      } },
    ))
}
app.get('/theme.css', c =>
  new Response(themeStyles(c.req.raw), {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'private, no-store' },
  }))
app.get('/textlog.svg', c =>
  new Response(themeLogoSvg(c.req.raw), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
    },
  }))
app.get('/favicon-theme.svg', c => {
  const selected = versionedAppearance(c.req.query('v'))
  return new Response(themeLogoSvg(c.req.raw, selected || undefined), {
    headers: selected
      ? {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      }
      : {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'private, no-store, no-cache, must-revalidate',
        'pragma': 'no-cache',
        'expires': '0',
      },
  })
})
app.get('/og.png', () => {
  return new Response(defaultOgBody, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(defaultOgBody.byteLength),
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
})

app.get('/client-error', c => clientErrorPage(c.req.raw))
app.get('/navigation-check', c => {
  const target = safeLocalPath(c.req.query('target'))
  const address = c.req.header(clientIpHeaderName()) || '-'
  return page(
    <NavigationCaptcha user={currentUser(c.req.raw)} target={target}
      captcha={navigationCaptchaChallenges.issue(address)} />,
  )
})
app.post('/navigation-check', async c => {
  const form = await limitedFormData(c.req.raw)
  const target = safeLocalPath(typeof form.get('target') === 'string' ? form.get('target') as string : undefined)
  const token = typeof form.get('captchaToken') === 'string' ? form.get('captchaToken') as string : ''
  const answer = typeof form.get('captchaAnswer') === 'string' ? form.get('captchaAnswer') as string : ''
  const address = c.req.header(clientIpHeaderName()) || '-'
  if (!navigationCaptchaChallenges.consume(address, token, answer)) {
    return page(
      <NavigationCaptcha user={currentUser(c.req.raw)} target={target}
        captcha={navigationCaptchaChallenges.issue(address)} error="That answer was not correct. Please try again." />,
      400,
    )
  }
  await allowNavigationCaptcha(address)
  navigationCaptchaGate.allow(address)
  return c.redirect(target, 303)
})
app.get('/panels-gallery', c => page(<PanelsGallery user={currentUser(c.req.raw)} />))
app.get('/blog/recap-v1', async c => {
  const user = currentUser(c.req.raw)
  const posts = await databaseService().call('blog.recapPosts', { viewerId: user?.id ?? -1 })
  return page(<BlogRecap user={user} posts={posts} pageUrl={c.req.url} />)
})
app.get('/blog/recap-v2', async c => {
  const user = currentUser(c.req.raw)
  const posts = await databaseService().call('blog.recapV2Posts', { viewerId: user?.id ?? -1 })
  return page(<BlogRecapV2 user={user} posts={posts} pageUrl={c.req.url} />)
})
app.get('/blog/building-textlog-without-javascript',
  c => page(<BlogBuildingWithoutJavascript user={currentUser(c.req.raw)} pageUrl={c.req.url} />))
app.get('/recap-email', async c =>
  c.html(await databaseService().call('maintenance.recapPreview', {
    requestUrl: c.req.url,
  }), 200, { 'cache-control': 'private, no-store' }))
app.get('/recap-email-v2', async c =>
  c.html(await databaseService().call('maintenance.recapV2Preview', {
    requestUrl: c.req.url,
  }), 200, { 'cache-control': 'private, no-store' }))
app.get('/interacted-email', async c =>
  c.html(await databaseService().call('maintenance.interactedPreview', {
    requestUrl: c.req.url,
  }), 200, { 'cache-control': 'private, no-store' }))
app.get('/server-error', () => {
  throw new Error('Intentional server error route')
})

registerApiRoutes(app)
registerEmbedRoutes(app)
registerFeedsRoutes(app)
registerAuthRoutes(app)
registerBookmarksRoutes(app)
registerAccountRoutes(app)
registerPostsRoutes(app)
registerInteractionsRoutes(app)
registerMediaRoutes(app)
registerIllegalActivityRoutes(app)
registerAdminRoutes(app)
registerStatsRoutes(app)
registerProfilesRoutes(app)
registerTagsRoutes(app)
registerSearchRoutes(app)
registerSeoRoutes(app)
setTimeout(() => {
  resumeRelationshipFeedInvalidation()
}, 0)
app.notFound(c => notFoundPage(c.req.raw))
app.onError((error, c) => {
  if (error instanceof RequestBodyError) return clientErrorPage(c.req.raw, error.status)
  if (error instanceof DatabaseUnavailableError) {
    return new Response('Service Unavailable', { status: 503, headers: {
      'cache-control': 'no-store',
      'retry-after': String(error.retryAfterSeconds),
    } })
  }
  logError(`${c.req.method} ${new URL(c.req.url).pathname}`, error)
  return serverErrorPage(c.req.raw)
})

export default {
  port: Number(Bun.env.PORT || 3000),
  host: Bun.env.HOST || '0.0.0.0',
  async fetch(request: Request, server: Bun.Server<unknown>) {
    // server.tsx sanitizes and sets this header before cloning the original Bun request.
    // requestIP() may no longer resolve the cloned Request, so prefer the trusted handoff.
    const address = clientIp(request, request.headers.get(clientIpHeaderName()) || server.requestIP(request)?.address)
    recordIpRequest(address)
    const url = new URL(request.url)
    const authenticated = Boolean(currentUser(request))
    const navigationChallengeAsset =
      /^(?:\/styles\.css|\/theme\.css|\/textlog\.svg|\/favicon-theme\.svg|\/favicon\.ico|\/favicon-\d+x\d+\.png|\/apple-touch-icon\.png|\/android-chrome-\d+x\d+\.png|\/maskable-icon-\d+x\d+\.png|\/uploads\/)/
        .test(url.pathname)
    if (!authenticated && navigationCaptchaGate.check(address) && url.pathname !== '/navigation-check'
      && !navigationChallengeAsset)
    {
      const target = url.pathname + url.search + url.hash
      return new Response(null, { status: 303,
        headers: { location: `/navigation-check?target=${encodeURIComponent(target)}` } })
    }
    if (!authenticated && url.pathname !== '/navigation-check'
      && nestedFromDepth(request.url) >= NESTED_FROM_MAX_DEPTH
      && !await isNavigationCaptchaAllowed(address))
    {
      navigationCaptchaGate.require(address)
      const target = url.pathname + url.search + url.hash
      return new Response(null, { status: 303,
        headers: { location: `/navigation-check?target=${encodeURIComponent(target)}` } })
    }
    if (isIpBlocked(address)) {
      const now = new Date()
      const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      return requestRateLimitResponse(request, Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000)))
    }
    const bypassRateLimits = Bun.env.NODE_ENV === 'test' || isDevelopment()
    const limited = bypassRateLimits
      ? null
      : requestRateLimiter.consume(address)
        ?? hourlyRequestRateLimiter.consume(address)
        ?? clientErrorRateLimiter.check(address)
    if (limited) return requestRateLimitResponse(request, limited.retryAfter)
    const headers = new Headers(request.headers)
    headers.set(clientIpHeaderName(), address)
    const response = await app.fetch(new Request(request, { headers }))
    if (!bypassRateLimits && response.status >= 400 && response.status < 500) {
      const clientErrorLimited = clientErrorRateLimiter.record(address)
      if (clientErrorLimited) return requestRateLimitResponse(request, clientErrorLimited.retryAfter)
    }
    return response
  },
}
logReady(`http://${Bun.env.HOST || 'localhost'}:${Bun.env.PORT || 3000}`,
  Bun.env.NODE_ENV || (devReloadEnabled ? 'development' : 'production'))
