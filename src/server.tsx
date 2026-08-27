import { clientIpHeaderName, sessionCookieName } from './brand'
import { validateStartupConfiguration } from './config'
import { configureDatabaseService } from './database-service'
import { notificationDevice, sessionCookie } from './http'
import { PAGE_SIZE } from './pagination'
import { withRequestContext } from './request-context'
import { DatabaseUnavailableError, RuntimeWorkerClient } from './runtime-worker-client'

const configuration = validateStartupConfiguration()
Bun.env.NODE_ENV = configuration.environment
Bun.env.DEV_RELOAD = String(configuration.devReload)
Bun.env.DEV_SEND_EMAILS = String(configuration.devSendEmails)
Bun.env.TRUST_PROXY = String(configuration.trustProxy)
Bun.env.LOG_COLOR = String(configuration.logColor)
Bun.env.LOG_ANONYMOUS = String(configuration.logAnonymous)
Bun.env.LOG_USER_AGENT = String(configuration.logUserAgent)
Bun.env.MODERATION_DISABLED = String(configuration.moderationDisabled)
Bun.env.MODERATION_CATEGORY_THRESHOLDS = configuration.moderationCategoryThresholds
Bun.env.ENABLE_CAPTCHA_ALWAYS = String(configuration.enableCaptchaAlways)
Bun.env.HOST = configuration.host
Bun.env.PORT = String(configuration.port)
Bun.env.DATABASE_PATH = configuration.databasePath
Bun.env.DATABASE_BUSY_TIMEOUT_MS = String(configuration.databaseBusyTimeoutMs)
Bun.env.DATABASE_BACKUP_DIR = configuration.backupDirectory
Bun.env.DATABASE_BACKUP_RETENTION_DAYS = String(configuration.backupRetentionDays)
if (configuration.backupAlertWebhookUrl) Bun.env.BACKUP_ALERT_WEBHOOK_URL = configuration.backupAlertWebhookUrl
if (configuration.appUrl) Bun.env.APP_URL = configuration.appUrl
if (configuration.moderationDisabled && configuration.production) {
  console.warn('configuration warning  content moderation is disabled in production')
}

const runtime = new RuntimeWorkerClient(new URL('./runtime-worker.ts', import.meta.url))
configureDatabaseService(runtime)

type Application = (typeof import('./app'))['default']
let application: Application | null = null
let startupError: unknown = null
const applicationReady = runtime.ready()
  .then(async () => {
    application = (await import('./app')).default
    return application
  })
  .catch(error => {
    startupError = error
    console.error('application startup failed', error)
    throw error
  })
void applicationReady.catch(() => undefined)
const STARTUP_REQUEST_TIMEOUT_SECONDS = 60
const STARTUP_QUEUE_WAIT_MS = 55_000
const STARTUP_QUEUE_LIMIT = 1_000
let startupQueueSize = 0

const degradedAssets = new Map<string, string>([
  ['/favicon.ico', 'image/x-icon'],
  ['/favicon-16x16.png', 'image/png'],
  ['/favicon-32x32.png', 'image/png'],
  ['/apple-touch-icon.png', 'image/png'],
  ['/android-chrome-192x192.png', 'image/png'],
  ['/android-chrome-512x512.png', 'image/png'],
  ['/maskable-icon-512x512.png', 'image/png'],
  ['/email-logo.png', 'image/png'],
])

function unavailableResponse(request: Request) {
  const path = new URL(request.url).pathname
  const retryAfter = String(runtime.retryAfterSeconds)
  if (path === '/health') {
    return Response.json({ status: 'unavailable', worker: runtime.state }, {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': retryAfter },
    })
  }
  const contentType = degradedAssets.get(path)
  if (contentType) {
    return new Response(Bun.file(new URL(`../public${path}`, import.meta.url)), {
      headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' },
    })
  }
  return new Response('Service Unavailable', {
    status: 503,
    headers: { 'cache-control': 'no-store', 'retry-after': retryAfter },
  })
}

function mainThreadAsset(request: Request) {
  const path = new URL(request.url).pathname
  const contentType = degradedAssets.get(path)
  if (!contentType) return null
  return new Response(Bun.file(new URL(`../public${path}`, import.meta.url)), {
    headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' },
  })
}

const databaseIndependentPaths = new Set([
  '/site.webmanifest',
  '/styles.css',
  '/embed.css',
  '/notifications.js',
  '/sw.js',
  '/theme.css',
  '/textlog.svg',
  '/favicon-theme.svg',
  '/og.png',
  '/dump.zip',
])

function isDatabaseIndependentRequest(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const path = new URL(request.url).pathname
  return databaseIndependentPaths.has(path) || path.startsWith('/uploads/')
}

function fetchWithoutIdentity(request: Request, server: Bun.Server<unknown>) {
  const readyApplication = application
  if (!readyApplication) throw new DatabaseUnavailableError('Application is starting')
  return withRequestContext({ sessionUser: null, apiUser: null, pageSize: PAGE_SIZE, density: 'regular' },
    () => readyApplication.fetch(request, server))
}

function cookieToken(request: Request) {
  const name = sessionCookieName()
  return request.headers.get('cookie')?.split(';').map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1) || null
}

function bearerToken(request: Request) {
  return request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] || null
}

async function requestWithResolvedIdentity(request: Request) {
  return await runtime.call('auth.resolve', {
    sessionToken: cookieToken(request),
    bearerToken: bearerToken(request),
    deviceId: notificationDevice(request),
    now: Date.now(),
  })
}

async function waitUntilReady(request: Request, server: Bun.Server<unknown>) {
  if (application && runtime.state === 'ready') return application
  if (startupQueueSize >= STARTUP_QUEUE_LIMIT) throw new DatabaseUnavailableError('Startup queue is full')
  startupQueueSize++
  server.timeout(request, STARTUP_REQUEST_TIMEOUT_SECONDS)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const readyApplication = await Promise.race([
      (async () => {
        const loadedApplication = await applicationReady
        if (runtime.state !== 'ready') await runtime.ready()
        return loadedApplication
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DatabaseUnavailableError('Application startup timed out')),
          STARTUP_QUEUE_WAIT_MS)
      }),
    ])
    return readyApplication
  }
  finally {
    if (timer) clearTimeout(timer)
    startupQueueSize--
  }
}

const server = Bun.serve({
  port: configuration.port,
  hostname: configuration.host,
  async fetch(request: Request, server: Bun.Server<unknown>) {
    const asset = mainThreadAsset(request)
    if (asset) return asset
    const path = new URL(request.url).pathname
    if (path === '/health' && (runtime.state !== 'ready' || !application || startupError)) {
      return unavailableResponse(request)
    }
    let readyApplication: Application
    try {
      readyApplication = await waitUntilReady(request, server)
    }
    catch {
      return unavailableResponse(request)
    }
    if (isDatabaseIndependentRequest(request)) return fetchWithoutIdentity(request, server)
    if (path === '/health') {
      return runtime.call('system.health', { databasePath: configuration.databasePath })
        .then(database =>
          Response.json({ status: 'ok', database }, {
            headers: { 'cache-control': 'no-store' },
          })
        )
        .catch(error => {
          if (!(error instanceof DatabaseUnavailableError)) console.error('health check failed', error)
          return unavailableResponse(request)
        })
    }
    const address = server.requestIP(request)?.address || null
    const identity = await requestWithResolvedIdentity(request).catch(error => {
      if (!(error instanceof DatabaseUnavailableError)) throw error
      return null
    })
    if (!identity) return unavailableResponse(request)
    const headers = new Headers(request.headers)
    headers.delete('x-textlog-session-user')
    headers.delete('x-textlog-api-user')
    headers.delete('x-textlog-page-size')
    headers.delete('x-textlog-density')
    headers.delete(clientIpHeaderName())
    if (address) headers.set(clientIpHeaderName(), address)
    const applicationRequest = new Request(request, { headers })
    return withRequestContext({ sessionUser: identity.sessionUser, apiUser: identity.apiUser,
      pageSize: identity.preferences.pageSize, density: identity.preferences.density },
      () => readyApplication.fetch(applicationRequest, server)).then(async response => {
        const token = cookieToken(request)
        if (token && await runtime.call('auth.renewSession', { token, now: Date.now() })) {
          response.headers.append('set-cookie', sessionCookie(token))
        }
        return response
      }).catch(error => {
        if (!(error instanceof DatabaseUnavailableError)) throw error
        return unavailableResponse(request)
      })
  },
})

console.log(`http listener ready  http://${server.hostname}:${server.port}`)
