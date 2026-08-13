import { sessionCookieName } from './brand'

export function stringField(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export const GLOBAL_REQUEST_BODY_LIMIT = 64 * 1024
export const FORM_REQUEST_BODY_LIMIT = 8 * 1024
export const ILLEGAL_REPORT_BODY_LIMIT = 16 * 1024

export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413 | 415, message: string) {
    super(message)
    this.name = 'RequestBodyError'
  }
}

export async function limitedFormData(request: Request, maxBytes = FORM_REQUEST_BODY_LIMIT) {
  const contentType = request.headers.get('content-type')?.toLowerCase() || ''
  const mediaType = contentType.split(';', 1)[0].trim()
  if (mediaType !== 'application/x-www-form-urlencoded' && mediaType !== 'multipart/form-data') {
    throw new RequestBodyError(415, 'Unsupported Media Type')
  }

  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError(413, 'Payload Too Large')
  }

  const body = await request.arrayBuffer()
  if (body.byteLength > maxBytes) throw new RequestBodyError(413, 'Payload Too Large')

  try {
    return await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    }).formData()
  }
  catch {
    throw new RequestBodyError(400, 'Invalid Form Body')
  }
}

export function safeLocalPath(value: string | undefined, requestUrl?: string, fallback = '/') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  try {
    const base = new URL(requestUrl || 'http://localhost')
    const parsed = new URL(value, base)
    return parsed.origin === base.origin ? parsed.pathname + parsed.search + parsed.hash : fallback
  }
  catch {
    return fallback
  }
}

export function safeRefererPath(referer: string | undefined, requestUrl: string, fallback = '/',
  appUrl: string | null | undefined = Bun.env.APP_URL)
{
  if (!referer) return fallback
  try {
    const request = new URL(appUrl || requestUrl)
    const target = new URL(referer)
    return target.origin === request.origin ? target.pathname + target.search : fallback
  }
  catch {
    return fallback
  }
}

// Browser forms are same-origin checked. The API is not, because it authenticates
// with a bearer token that a browser cannot attach to a cross-site request, and a
// native client sends neither Origin nor Referer.
export function requiresSameOrigin(method: string, path: string) {
  return method !== 'GET' && method !== 'HEAD' && !path.startsWith('/api/')
}

export function isSameOriginRequest(request: Request, appUrl: string | null | undefined = Bun.env.APP_URL) {
  try {
    const expectedOrigin = new URL(appUrl || request.url).origin
    const origin = request.headers.get('origin')
    if (origin) return new URL(origin).origin === expectedOrigin

    const referer = request.headers.get('referer')
    return Boolean(referer && new URL(referer).origin === expectedOrigin)
  }
  catch {
    return false
  }
}

export function securityHeaders(devReload = false, appUrl: string | undefined = Bun.env.APP_URL, embeddable = false,
  scripts = false)
{
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      'default-src \'self\'',
      'base-uri \'none\'',
      'form-action \'self\'',
      embeddable ? 'frame-ancestors *' : 'frame-ancestors \'none\'',
      'object-src \'none\'',
      'img-src \'self\' data:',
      'style-src \'self\' \'unsafe-inline\'',
      devReload ? 'script-src \'self\' \'unsafe-inline\'' : scripts ? 'script-src \'self\'' : 'script-src \'none\'',
      'connect-src \'self\'',
    ].join('; '),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  }
  if (!embeddable) headers['X-Frame-Options'] = 'DENY'
  try {
    if (appUrl && new URL(appUrl).protocol === 'https:') {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
  }
  catch {
    // Invalid deployment URLs are handled elsewhere; do not emit HSTS for them.
  }
  return headers
}

function secureCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  if (!appUrl) return ''
  try {
    return new URL(appUrl).protocol === 'https:' ? '; Secure' : ''
  }
  catch {
    return ''
  }
}

export function sessionCookie(value: string, maxAge = 365 * 24 * 60 * 60,
  appUrl: string | undefined = Bun.env.APP_URL)
{
  return `${sessionCookieName()}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secureCookie(appUrl)}`
}

export function clearSessionCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return sessionCookie('', 0, appUrl)
}

const NOTIFICATION_DEVICE_COOKIE = 'notification_device'
const NOTIFICATION_BANNER_COOKIE = 'notification_banner_dismissed'

function cookieValue(request: Request, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1] || null
}

export function notificationDevice(request: Request) {
  const value = cookieValue(request, NOTIFICATION_DEVICE_COOKIE)
  return value && /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : null
}

export function notificationDeviceCookie(value: string, appUrl: string | undefined = Bun.env.APP_URL) {
  return `${NOTIFICATION_DEVICE_COOKIE}=${value}; Max-Age=${5 * 365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

export function notificationBannerDismissed(request: Request, userId: number) {
  return cookieValue(request, NOTIFICATION_BANNER_COOKIE) === String(userId)
}

export function notificationBannerDismissedCookie(userId: number, appUrl: string | undefined = Bun.env.APP_URL) {
  return `${NOTIFICATION_BANNER_COOKIE}=${userId}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

const publicHtmlPaths = new Set([
  '/',
  '/hot',
  '/latest',
  '/explore',
  '/about',
  '/contact',
  '/dmca',
  '/legal',
  '/api',
  '/api/embed-examples',
])
const publicHtmlPattern = /^\/(?:u\/[a-z0-9_]{2,24}|post\/[1-9]\d*|tag\/[a-z0-9_]+|embed\/.+)$/i
const transientHtmlParameters = ['reply', 'report', 'reported', 'edit', 'welcome', 'reset', 'token']

export function htmlCacheControl(request: Request, response: Response) {
  if (!['GET', 'HEAD'].includes(request.method) || response.status !== 200) return 'private, no-store'
  if (request.headers.has('cookie') || request.headers.has('authorization') || response.headers.has('set-cookie')) {
    return 'private, no-store'
  }
  const url = new URL(request.url)
  if (transientHtmlParameters.some(name => url.searchParams.has(name))) return 'private, no-store'
  if (!publicHtmlPaths.has(url.pathname) && !publicHtmlPattern.test(url.pathname)) return 'private, no-store'
  return 'public, max-age=30, stale-while-revalidate=120'
}

export function applyHtmlCachePolicy(request: Request, response: Response) {
  const policy = htmlCacheControl(request, response)
  response.headers.set('cache-control', policy)
  if (!policy.startsWith('public')) return
  const vary = response.headers.get('vary')
  const values = vary?.split(',').map(value => value.trim().toLowerCase()) || []
  if (!values.includes('cookie')) response.headers.set('vary', vary ? `${vary}, Cookie` : 'Cookie')
}

const crawlerUserAgent = /(?:\bbot\b|bot[\s/_-]|crawler|spider|slurp|facebookexternalhit|ia_archiver)/i

export function isCrawlerRequest(request: Request) {
  return crawlerUserAgent.test(request.headers.get('user-agent') || '')
}

export function crawlerCanonicalRedirect(request: Request, appUrl: string | undefined = Bun.env.APP_URL) {
  if (request.method !== 'GET' || !isCrawlerRequest(request)) return null
  const url = new URL(request.url)
  let destination = url
  if (url.pathname === '/enter') {
    destination = new URL(safeLocalPath(url.searchParams.get('next') || '/'), url.origin)
    destination.searchParams.delete('reply')
  }
  else {
    if (!url.searchParams.has('from')) return null
    destination.searchParams.delete('from')
  }
  destination.searchParams.delete('from')
  const origin = appUrl ? new URL(appUrl).origin : url.origin
  const location = origin + destination.pathname + destination.search
  return new Response(null, { status: 302, headers: {
    location,
    'cache-control': 'private, no-store',
    vary: 'User-Agent',
  } })
}

export type FeedPreference = 'following' | 'activity' | 'hot' | 'latest'

export function feedPreference(request: Request): FeedPreference | null {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)feed=(following|activity|hot|latest)(?:;|$)/)?.[1]
  return value as FeedPreference | undefined || null
}

export function feedPreferenceCookie(value: FeedPreference) {
  return `feed=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}
