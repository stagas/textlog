import { applyHtmlCachePolicy, blockedCrawlerResponse, canonicalizeCrawlerLinks, crawlerCanonicalRedirect,
  GLOBAL_REQUEST_BODY_LIMIT, isSameOriginRequest, RequestBodyError, requiresSameOrigin, safeLocalPath, securityHeaders,
  sessionCookie } from './http'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { startAutomatedBackups } from './backup-automation'
import { appName, clientIpHeaderName } from './brand'
import { configureDevReload } from './components/layout'
import { compressResponse } from './compression'
import { databaseHealth } from './database-health'
import { db } from './db'
import { isDevelopment } from './environment'
import { clientIp, logError, logHttp, logReady, shouldLogHttp } from './log'
import { startMaintenance } from './maintenance'
import { renderDefaultOg } from './og'
import { startPublicArchive } from './public-archive'
import { ClientErrorRateLimiter, HOURLY_REQUEST_BLOCK_SECONDS, HOURLY_REQUEST_RATE_LIMIT,
  HOURLY_REQUEST_RATE_WINDOW_SECONDS, rateLimitedResponse, RequestRateLimiter } from './request-rate-limit'
import { registerAccountRoutes } from './routes/account'
import { registerAdminRoutes } from './routes/admin'
import { registerApiRoutes } from './routes/api'
import { registerAuthRoutes } from './routes/auth'
import { registerEmbedRoutes } from './routes/embed'
import { registerFeedsRoutes } from './routes/feeds'
import { registerIllegalActivityRoutes } from './routes/illegal-activity'
import { registerInteractionsRoutes } from './routes/interactions'
import { registerPostsRoutes } from './routes/posts'
import { registerProfilesRoutes } from './routes/profiles'
import { registerSearchRoutes } from './routes/search'
import { registerSeoRoutes } from './routes/seo'
import { clientErrorPage, notFoundPage, serverErrorPage } from './routes/shared'
import { registerStatsRoutes } from './routes/stats'
import { registerTagsRoutes } from './routes/tags'
import { renewSession } from './sessions'
import { loadStylesAsset, stylesResponse } from './styles'
import { themeLogoSvg, themeStyles, versionedAppearance, withAppearance } from './theme'
import { currentUser, sessionToken } from './utils'
import { VisitorBuffer } from './visitors'

const devReloadEnabled = Bun.env.DEV_RELOAD === 'true'
const publicArchivePath = Bun.env.PUBLIC_ARCHIVE_PATH || 'public/dump.zip'
const bootId = crypto.randomUUID()
configureDevReload(devReloadEnabled ? bootId : undefined)
const app = new Hono()
app.use('*', (c, next) => withAppearance(c.req.raw, next))
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
const visitorBuffer = new VisitorBuffer(db)
const requestRateLimiter = new RequestRateLimiter()
const hourlyRequestRateLimiter = new RequestRateLimiter({
  limit: HOURLY_REQUEST_RATE_LIMIT,
  windowSeconds: HOURLY_REQUEST_RATE_WINDOW_SECONDS,
  blockSeconds: HOURLY_REQUEST_BLOCK_SECONDS,
})
const clientErrorRateLimiter = new ClientErrorRateLimiter()
startMaintenance(db, visitorBuffer, error => logError('database maintenance failed', error))
if (Bun.env.NODE_ENV === 'production') {
  startAutomatedBackups(db, {
    directory: Bun.env.DATABASE_BACKUP_DIR || 'storage/backups',
    alertWebhookUrl: Bun.env.BACKUP_ALERT_WEBHOOK_URL || null,
  })
  startPublicArchive(db, { path: publicArchivePath })
}

app.use('*', bodyLimit({
  maxSize: GLOBAL_REQUEST_BODY_LIMIT,
  onError: c => clientErrorPage(c.req.raw, 413),
}))

app.use('*', async (c, next) => {
  await next()
  const value = sessionToken(c.req.raw)
  if (value && renewSession(db, value)) c.header('Set-Cookie', sessionCookie(value), { append: true })
})

app.use('*', async (c, next) => {
  await next()
  if (c.res.status < 400 || c.res.status >= 500 || c.req.method !== 'GET') return
  if (!c.req.header('accept')?.includes('text/html')) return
  if (!c.res.headers.get('content-type')?.includes('text/plain')) return
  c.res = clientErrorPage(c.req.raw, c.res.status)
})

app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || c.res.status >= 400 || !c.res.headers.get('content-type')?.includes('text/html')) return
  try {
    visitorBuffer.record(c.req.header(clientIpHeaderName()) || '-')
  }
  catch (error) {
    logError('visitor buffer flush failed', error)
  }
})

app.use('*', async (c, next) => {
  const started = performance.now()
  const username = currentUser(c.req.raw)?.handle
  try {
    await next()
  }
  finally {
    const url = new URL(c.req.url)
    const path = url.pathname
    if (shouldLogHttp(path, c.res.status)) {
      logHttp(c.req.method, `${path}${url.search}`, c.res.status, performance.now() - started,
        c.req.header(clientIpHeaderName()) || '-', username, c.req.header('user-agent') || '-')
    }
  }
})

app.use('*', async (c, next) => {
  await next()
  c.res = await compressResponse(c.req.raw, c.res)
})

app.use('*', async (c, next) => {
  const blocked = blockedCrawlerResponse(c.req.raw)
  if (blocked) return blocked
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
    /^\/(?:enter|forgot-password|reset-password|choose-handle|write|compose|activity|admin|search|account)(?:\/|$)/
      .test(url.pathname) || /^\/post\/\d+\/(?:edit|delete)$/.test(url.pathname)
  const transientParameters = ['reply', 'report', 'reported', 'edit', 'welcome', 'reset', 'token']
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
  if (c.req.method !== 'POST' || ['/enter', '/choose-handle', '/logout'].includes(c.req.path)) return next()
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
app.get('/health', c => {
  try {
    const database = databaseHealth(db, Bun.env.DATABASE_PATH || 'storage/textlog.sqlite')
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
app.get('/site.webmanifest', c =>
  c.json({
    name: appName(),
    short_name: appName(),
    icons: [
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    theme_color: '#20231f',
    background_color: '#f4f3ee',
    display: 'standalone',
    start_url: '/',
  }, 200, { 'cache-control': 'no-cache' }))
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
app.get('/server-error', () => {
  throw new Error('Intentional server error route')
})

registerApiRoutes(app)
registerEmbedRoutes(app)
registerFeedsRoutes(app)
registerAuthRoutes(app)
registerAccountRoutes(app)
registerPostsRoutes(app)
registerInteractionsRoutes(app)
registerIllegalActivityRoutes(app)
registerAdminRoutes(app)
registerStatsRoutes(app)
registerProfilesRoutes(app)
registerTagsRoutes(app)
registerSearchRoutes(app)
registerSeoRoutes(app)
app.notFound(c => notFoundPage(c.req.raw))
app.onError((error, c) => {
  if (error instanceof RequestBodyError) return clientErrorPage(c.req.raw, error.status)
  logError(`${c.req.method} ${new URL(c.req.url).pathname}`, error)
  return serverErrorPage(c.req.raw)
})

export default {
  port: Number(Bun.env.PORT || 3000),
  host: Bun.env.HOST || '0.0.0.0',
  async fetch(request: Request, server: Bun.Server<unknown>) {
    const address = clientIp(request, server.requestIP(request)?.address)
    const bypassRateLimits = Bun.env.NODE_ENV === 'test' || isDevelopment()
    const limited = bypassRateLimits
      ? null
      : requestRateLimiter.consume(address)
        ?? hourlyRequestRateLimiter.consume(address)
        ?? clientErrorRateLimiter.check(address)
    if (limited) return rateLimitedResponse(limited.retryAfter)
    const headers = new Headers(request.headers)
    headers.set(clientIpHeaderName(), address)
    const response = await app.fetch(new Request(request, { headers }))
    if (!bypassRateLimits && response.status >= 400 && response.status < 500) {
      const clientErrorLimited = clientErrorRateLimiter.record(address)
      if (clientErrorLimited) return rateLimitedResponse(clientErrorLimited.retryAfter)
    }
    return response
  },
}
logReady(`http://${Bun.env.HOST || 'localhost'}:${Bun.env.PORT || 3000}`,
  Bun.env.NODE_ENV || (devReloadEnabled ? 'development' : 'production'))
