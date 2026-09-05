import { randomUUID } from 'node:crypto'
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
    && path !== '/install/banner/dismiss'
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
      'img-src \'self\' data: https:',
      'media-src \'self\' https:',
      'style-src \'self\' \'unsafe-inline\' https://fonts.cdnfonts.com',
      'font-src \'self\' https://fonts.cdnfonts.com',
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
const DONATION_BANNER_COOKIE = 'donation_banner_dismissed'
const CAMPAIGN_ATTRIBUTION_COOKIE = 'campaign_attribution'
const PWA_STANDALONE_COOKIE = 'pwa_standalone'
const PWA_INSTALL_BANNER_COOKIE = 'pwa_install_banner_dismissed'
const EXPLORE_WELCOME_COOKIE = 'explore_welcome'
const RETURNING_VISITOR_COOKIE = 'returning_visitor'
const PENDING_POST_COOKIE = 'pending_post'
const PENDING_FOLLOW_COOKIE = 'pending_follow'
const PENDING_POLL_COOKIE = 'pending_poll'

function cookieValue(request: Request, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1] || null
}

export function pendingPost(request: Request) {
  const value = cookieValue(request, PENDING_POST_COOKIE)
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      body?: unknown
      returnPath?: unknown
      parentId?: unknown
      replyPageId?: unknown
      key?: unknown
    }
    return typeof parsed.body === 'string'
      ? {
        body: parsed.body,
        returnPath: safeLocalPath(typeof parsed.returnPath === 'string' ? parsed.returnPath : '/'),
        parentId: Number.isInteger(parsed.parentId) && Number(parsed.parentId) > 0 ? Number(parsed.parentId) : null,
        replyPageId: Number.isInteger(parsed.replyPageId) && Number(parsed.replyPageId) > 0
          ? Number(parsed.replyPageId)
          : null,
        key: typeof parsed.key === 'string' && /^[0-9a-f-]{36}$/.test(parsed.key) ? parsed.key : null,
      }
      : null
  }
  catch {
    return null
  }
}

export function pendingPostCookie(body: string, returnPath: string, parentId: number | null = null,
  replyPageId: number | null = null, maxAge = 20 * 60, appUrl: string | undefined = Bun.env.APP_URL)
{
  const value = Buffer.from(
    JSON.stringify({ body, returnPath: safeLocalPath(returnPath), parentId, replyPageId,
      key: maxAge > 0 ? randomUUID() : null }),
  )
    .toString('base64url')
  return `${PENDING_POST_COOKIE}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secureCookie(appUrl)}`
}

export function clearPendingPostCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return pendingPostCookie('', '/', null, null, 0, appUrl)
}

export function pendingFollow(request: Request) {
  const value = cookieValue(request, PENDING_FOLLOW_COOKIE)
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      kind?: unknown
      target?: unknown
      returnPath?: unknown
    }
    if ((parsed.kind !== 'user' && parsed.kind !== 'tag') || typeof parsed.target !== 'string') return null
    return {
      kind: parsed.kind,
      target: parsed.target,
      returnPath: safeLocalPath(typeof parsed.returnPath === 'string' ? parsed.returnPath : '/'),
    }
  }
  catch {
    return null
  }
}

export function pendingFollowCookie(kind: 'user' | 'tag', target: string, returnPath: string, maxAge = 20 * 60,
  appUrl: string | undefined = Bun.env.APP_URL)
{
  const value = Buffer.from(JSON.stringify({ kind, target, returnPath: safeLocalPath(returnPath) })).toString(
    'base64url',
  )
  return `${PENDING_FOLLOW_COOKIE}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secureCookie(appUrl)}`
}

export function clearPendingFollowCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return pendingFollowCookie('user', '', '/', 0, appUrl)
}

export function pendingPoll(request: Request) {
  const value = cookieValue(request, PENDING_POLL_COOKIE)
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      postId?: unknown
      optionId?: unknown
    }
    if (!Number.isInteger(parsed.postId) || Number(parsed.postId) < 1
      || !Number.isInteger(parsed.optionId) || Number(parsed.optionId) < 1) return null
    return { postId: Number(parsed.postId), optionId: Number(parsed.optionId) }
  }
  catch {
    return null
  }
}

export function pendingPollCookie(postId: number, optionId: number, maxAge = 20 * 60,
  appUrl: string | undefined = Bun.env.APP_URL)
{
  const value = Buffer.from(JSON.stringify({ postId, optionId })).toString('base64url')
  return `${PENDING_POLL_COOKIE}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secureCookie(appUrl)}`
}

export function clearPendingPollCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return pendingPollCookie(0, 0, 0, appUrl)
}

export function exploreWelcome(request: Request) {
  return cookieValue(request, EXPLORE_WELCOME_COOKIE) === '1'
}

export function exploreWelcomeCookie(value = '1', maxAge = 365 * 24 * 60 * 60,
  appUrl: string | undefined = Bun.env.APP_URL)
{
  return `${EXPLORE_WELCOME_COOKIE}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/explore; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

export function returningVisitor(request: Request) {
  return cookieValue(request, RETURNING_VISITOR_COOKIE) === '1'
}

export function returningVisitorCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return `${RETURNING_VISITOR_COOKIE}=1; Max-Age=${5 * 365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

export function campaignAttribution(request: Request) {
  const value = cookieValue(request, CAMPAIGN_ATTRIBUTION_COOKIE)
  return value && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null
}

export function campaignAttributionCookie(value: string, maxAge = 30 * 24 * 60 * 60,
  appUrl: string | undefined = Bun.env.APP_URL)
{
  return `${CAMPAIGN_ATTRIBUTION_COOKIE}=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
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

export function notificationUserAgent(request: Request) {
  return (request.headers.get('user-agent') || '').trim().slice(0, 512)
}

export function notificationBannerDismissed(request: Request, userId: number) {
  return cookieValue(request, NOTIFICATION_BANNER_COOKIE) === String(userId)
}

export function donationBannerDismissed(request: Request) {
  return cookieValue(request, DONATION_BANNER_COOKIE) === '1'
}

export function donationBannerDismissedCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return `${DONATION_BANNER_COOKIE}=1; Max-Age=${5 * 365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

export function pwaStandalone(request: Request) {
  return cookieValue(request, PWA_STANDALONE_COOKIE) === '1'
}

export function pwaInstallBannerDismissed(request: Request) {
  return cookieValue(request, PWA_INSTALL_BANNER_COOKIE) === '1'
}

export function pwaStandaloneCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return `${PWA_STANDALONE_COOKIE}=1; Max-Age=${5 * 365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

export function pwaInstallBannerDismissedCookie(appUrl: string | undefined = Bun.env.APP_URL) {
  return `${PWA_INSTALL_BANNER_COOKIE}=1; Max-Age=${5 * 365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${
    secureCookie(appUrl)
  }`
}

const publicHtmlPaths = new Set([
  '/',
  '/hot',
  '/all',
  '/any',
  '/explore',
  '/about',
  '/contact',
  '/dmca',
  '/legal',
  '/api',
  '/api/embed-examples',
])
const publicHtmlPattern = /^\/(?:u\/[a-z0-9_]{2,24}|post\/[1-9]\d*|tag\/[a-z0-9_]+|embed\/.+)$/i
const transientHtmlParameters = ['reply', 'report', 'reported', 'edit', 'reset', 'token']

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
  const additions = [!values.includes('user-agent') && 'User-Agent', !values.includes('cookie') && 'Cookie']
    .filter(Boolean)
  if (additions.length) response.headers.set('vary', [vary, ...additions].filter(Boolean).join(', '))
}

const crawlerUserAgent =
  /(?:\bbot\b|bot[\s/_-]|crawler|spider|slurp|googleother|facebookexternalhit|meta-external(?:agent|fetcher)|ia_archiver)/i

export function isCrawlerRequest(request: Request) {
  return crawlerUserAgent.test(request.headers.get('user-agent') || '')
}

export function crawlerCanonicalRedirect(request: Request, appUrl: string | undefined = Bun.env.APP_URL) {
  if (request.method !== 'GET' || !isCrawlerRequest(request)) return null
  const url = new URL(request.url)
  let destination = url
  if (url.pathname === '/enter' || url.pathname === '/enter/password') {
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
  return new Response(null, { status: 301, headers: {
    location,
    'cache-control': 'private, no-store',
    vary: 'User-Agent',
  } })
}

function crawlerCanonicalHref(value: string) {
  if (!value.startsWith('/')) return value
  const url = new URL(value.replaceAll('&amp;', '&'), 'https://textlog.invalid')
  url.searchParams.delete('from')
  const next = url.searchParams.get('next')
  if (next?.startsWith('/')) url.searchParams.set('next', crawlerCanonicalHref(next))
  return (url.pathname + url.search + url.hash).replaceAll('&', '&amp;')
}

export async function canonicalizeCrawlerLinks(request: Request, response: Response) {
  if (!isCrawlerRequest(request) || !response.headers.get('content-type')?.includes('text/html')) return response
  const html = await response.text()
  const body = html.replace(/\bhref="([^"]*)"/g, (_, href: string) => `href="${crawlerCanonicalHref(href)}"`)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  const vary = headers.get('vary')
  const values = vary?.split(',').map(value => value.trim().toLowerCase()) || []
  if (!values.includes('user-agent')) headers.set('vary', vary ? `${vary}, User-Agent` : 'User-Agent')
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

export type FeedPreference = 'following' | 'activity' | 'hot' | 'latest' | 'new' | 'random'

export function feedPreference(request: Request): FeedPreference | null {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)feed=(following|activity|hot|latest|new|random)(?:;|$)/)
    ?.[1]
  return value as FeedPreference | undefined || null
}

export function feedPreferenceCookie(value: FeedPreference) {
  return `feed=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}

export function retainedAnyFeedSeed(request: Request) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)any_sample_seed=([0-9a-z]+)(?:;|$)/)?.[1]
  const seed = Number.parseInt(value || '', 36)
  return Number.isSafeInteger(seed) && seed > 0 && seed < 2_147_483_647 ? seed : null
}

export function retainedAnyFeedSeedCookie(seed: number) {
  const safeSeed = Math.max(1, Math.floor(seed))
  return `any_sample_seed=${safeSeed.toString(36)}; Max-Age=${
    365 * 24 * 60 * 60
  }; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}
