import { applyHtmlCachePolicy, GLOBAL_REQUEST_BODY_LIMIT, isSameOriginRequest, RequestBodyError, safeLocalPath,
  securityHeaders, sessionCookie } from './http'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { startAutomatedBackups } from './backup-automation'
import { configureDevReload } from './components/layout'
import { compressResponse } from './compression'
import { databaseHealth } from './database-health'
import { db } from './db'
import { clientIp, logError, logHttp, logReady, shouldLogHttp } from './log'
import { startMaintenance } from './maintenance'
import { renderDefaultOg } from './og'
import { rateLimitedResponse, RequestRateLimiter } from './request-rate-limit'
import { registerAccountRoutes } from './routes/account'
import { registerAdminRoutes } from './routes/admin'
import { registerApiRoutes } from './routes/api'
import { registerAuthRoutes } from './routes/auth'
import { registerFeedsRoutes } from './routes/feeds'
import { registerIllegalActivityRoutes } from './routes/illegal-activity'
import { registerInteractionsRoutes } from './routes/interactions'
import { registerPostsRoutes } from './routes/posts'
import { registerProfilesRoutes } from './routes/profiles'
import { registerSeoRoutes } from './routes/seo'
import { clientErrorPage, notFoundPage, serverErrorPage } from './routes/shared'
import { registerTagsRoutes } from './routes/tags'
import { renewSession } from './sessions'
import { loadStylesAsset, stylesResponse } from './styles'
import { currentUser, sessionToken } from './utils'
import { themeLogoSvg, themeStyles, withAppearance } from './theme'
import { VisitorBuffer } from './visitors'

const devReloadEnabled = Bun.env.DEV_RELOAD === 'true'
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
  ['/site.webmanifest', 'application/manifest+json; charset=utf-8'],
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
startMaintenance(db, visitorBuffer, error => logError('database maintenance failed', error))
if (Bun.env.NODE_ENV === 'production') {
  startAutomatedBackups(db, {
    directory: Bun.env.DATABASE_BACKUP_DIR || 'storage/backups',
    alertWebhookUrl: Bun.env.BACKUP_ALERT_WEBHOOK_URL || null,
  })
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
    visitorBuffer.record(c.req.header('x-textlog-client-ip') || '-')
  }
  catch (error) {
    logError('visitor buffer flush failed', error)
  }
})

app.use('*', async (c, next) => {
  const started = performance.now()
  try {
    await next()
  }
  finally {
    const path = new URL(c.req.url).pathname
    if (shouldLogHttp(path, c.res.status)) {
      logHttp(c.req.method, path, c.res.status, performance.now() - started, c.req.header('x-textlog-client-ip') || '-')
    }
  }
})

app.use('*', async (c, next) => {
  await next()
  c.res = await compressResponse(c.req.raw, c.res)
})

app.use('*', async (c, next) => {
  await next()
  for (const [name, value] of Object.entries(securityHeaders(devReloadEnabled))) c.header(name, value)
  if (c.req.path === '/textlog.svg' || c.req.path === '/favicon-theme.svg') {
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
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
  const privatePath = /^\/(?:enter|choose-handle|write|compose|activity|admin|account\/delete)(?:\/|$)/
    .test(url.pathname) || /^\/post\/\d+\/(?:edit|delete)$/.test(url.pathname)
  const transientParameters = ['reply', 'report', 'reported', 'edit', 'welcome', 'reset', 'token']
  const transient = transientParameters.some(name => url.searchParams.has(name))
  if (privatePath || transient || c.res.status >= 400) c.header('X-Robots-Tag', 'noindex, nofollow')
  if (!privatePath && c.res.status < 400) {
    for (const name of transientParameters) url.searchParams.delete(name)
    if (url.searchParams.get('page') === '1') url.searchParams.delete('page')
    const configuredOrigin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : url.origin
    c.header('Link', `<${configuredOrigin + url.pathname + url.search}>; rel="canonical"`)
  }
})
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !isSameOriginRequest(c.req.raw)) return c.text('Forbidden', 403)
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
if (devReloadEnabled) {
  app.get('/__dev/restart', c => c.json({ bootId }, 200, { 'cache-control': 'no-store, no-cache, must-revalidate' }))
}
for (const asset of publicAssets) {
  app.get(asset.path, () => new Response(asset.body, {
    headers: {
      'content-type': asset.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  }))
}
app.get('/styles.css', async c => {
  const asset = styles ?? await loadStylesAsset(stylesPath)
  return stylesResponse(asset, c.req.raw, !devReloadEnabled)
})
app.get('/theme.css', c => new Response(themeStyles(c.req.raw), {
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
app.get('/favicon-theme.svg', c =>
  new Response(themeLogoSvg(c.req.raw), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
      'expires': '0',
    },
  }))
app.get('/og.png', () => {
  return new Response(defaultOgBody, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' },
  })
})

app.get('/client-error', c => clientErrorPage(c.req.raw))
app.get('/server-error', () => {
  throw new Error('Intentional server error route')
})

registerApiRoutes(app)
registerFeedsRoutes(app)
registerAuthRoutes(app)
registerAccountRoutes(app)
registerPostsRoutes(app)
registerInteractionsRoutes(app)
registerIllegalActivityRoutes(app)
registerAdminRoutes(app)
registerProfilesRoutes(app)
registerTagsRoutes(app)
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
  fetch(request: Request, server: Bun.Server<unknown>) {
    const address = clientIp(request, server.requestIP(request)?.address)
    const limited = Bun.env.NODE_ENV === 'test' ? null : requestRateLimiter.consume(address)
    if (limited) return rateLimitedResponse(limited.retryAfter)
    const headers = new Headers(request.headers)
    headers.set('x-textlog-client-ip', address)
    return app.fetch(new Request(request, { headers }))
  },
}
logReady(`http://${Bun.env.HOST || 'localhost'}:${Bun.env.PORT || 3000}`,
  Bun.env.NODE_ENV || (devReloadEnabled ? 'development' : 'production'))
