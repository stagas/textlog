import { isSameOriginRequest, securityHeaders } from './http'

import { Hono } from 'hono'
import { configureDevReload } from './components/layout'
import { compressResponse } from './compression'
import { db } from './db'
import { renderDefaultOg } from './og'
import { registerAccountRoutes } from './routes/account'
import { registerAdminRoutes } from './routes/admin'
import { registerAuthRoutes } from './routes/auth'
import { registerFeedsRoutes } from './routes/feeds'
import { registerInteractionsRoutes } from './routes/interactions'
import { registerPostsRoutes } from './routes/posts'
import { registerProfilesRoutes } from './routes/profiles'
import { registerTagsRoutes } from './routes/tags'
import { loadStylesAsset, stylesResponse } from './styles'
import { clientIp, logError, logHttp, logReady, shouldLogHttp } from './log'
import { recordVisit } from './visitors'

const devReloadEnabled = Bun.env.DEV_RELOAD === 'true'
const bootId = crypto.randomUUID()
configureDevReload(devReloadEnabled ? bootId : undefined)
const app = new Hono()
const stylesPath = new URL('./styles.css', import.meta.url).pathname
const styles = devReloadEnabled ? undefined : await loadStylesAsset(stylesPath)

app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || c.res.status >= 400 || !c.res.headers.get('content-type')?.includes('text/html')) return
  recordVisit(db, c.req.header('x-root-client-ip') || '-')
})

app.use('*', async (c, next) => {
  const started = performance.now()
  try {
    await next()
  }
  finally {
    const path = new URL(c.req.url).pathname
    if (shouldLogHttp(path, c.res.status)) {
      logHttp(c.req.method, path, c.res.status, performance.now() - started,
        c.req.header('x-root-client-ip') || '-')
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
})
app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || !c.res.headers.get('content-type')?.includes('text/html')) return
  const url = new URL(c.req.url)
  const privatePath =
    /^\/(?:login|signup|forgot-password|reset-password|write|compose|activity|admin|account\/delete)(?:\/|$)/
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
app.get('/health', c => {
  try {
    const result = db.query('SELECT 1 AS ok').get() as { ok: number } | null
    if (result?.ok !== 1) throw new Error('Database health check failed')
    return c.json({ status: 'ok' }, 200, { 'cache-control': 'no-store' })
  }
  catch (error) {
    logError('health check failed', error)
    return c.json({ status: 'unavailable' }, 503, { 'cache-control': 'no-store' })
  }
})
if (devReloadEnabled) {
  app.get('/__dev/restart', c => c.json({ bootId }, 200, { 'cache-control': 'no-store, no-cache, must-revalidate' }))
}
app.get('/styles.css', async c => {
  const asset = styles ?? await loadStylesAsset(stylesPath)
  return stylesResponse(asset, c.req.raw, !devReloadEnabled)
})
app.get('/root.svg',
  () =>
    new Response(Bun.file(new URL('./root.svg', import.meta.url)), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    }))
app.get('/og.png', () => {
  const image = renderDefaultOg()
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
  return new Response(body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' },
  })
})

registerFeedsRoutes(app)
registerAuthRoutes(app)
registerAccountRoutes(app)
registerPostsRoutes(app)
registerInteractionsRoutes(app)
registerAdminRoutes(app)
registerProfilesRoutes(app)
registerTagsRoutes(app)
app.notFound(c => c.text('Not found', 404))
app.onError((error, c) => {
  logError(`${c.req.method} ${new URL(c.req.url).pathname}`, error)
  return c.text('Something went wrong', 500)
})

export default {
  port: 3000,
  host: '0.0.0.0',
  fetch(request: Request, server: Bun.Server<unknown>) {
    const headers = new Headers(request.headers)
    headers.set('x-root-client-ip', clientIp(request, server.requestIP(request)?.address))
    return app.fetch(new Request(request, { headers }))
  },
}
logReady('http://localhost:3000', Bun.env.NODE_ENV || (devReloadEnabled ? 'development' : 'production'))
