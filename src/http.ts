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
  if (mediaType !== 'application/x-www-form-urlencoded' && mediaType !== 'multipart/form-data')
  {
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
    return parsed.origin === base.origin ? parsed.pathname + parsed.search : fallback
  }
  catch {
    return fallback
  }
}

export function safeRefererPath(referer: string | undefined, requestUrl: string, fallback = '/') {
  if (!referer) return fallback
  try {
    const request = new URL(Bun.env.APP_URL || requestUrl)
    const target = new URL(referer)
    return target.origin === request.origin ? target.pathname + target.search : fallback
  }
  catch {
    return fallback
  }
}

export function isSameOriginRequest(request: Request) {
  try {
    const expectedOrigin = new URL(Bun.env.APP_URL || request.url).origin
    const origin = request.headers.get('origin')
    if (origin) return new URL(origin).origin === expectedOrigin

    const referer = request.headers.get('referer')
    return Boolean(referer && new URL(referer).origin === expectedOrigin)
  }
  catch {
    return false
  }
}

export function securityHeaders(devReload = false) {
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      'default-src \'self\'',
      'base-uri \'none\'',
      'form-action \'self\'',
      'frame-ancestors \'none\'',
      'object-src \'none\'',
      'img-src \'self\' data:',
      'style-src \'self\'',
      devReload ? 'script-src \'self\' \'unsafe-inline\'' : 'script-src \'none\'',
      'connect-src \'self\'',
    ].join('; '),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
  try {
    if (Bun.env.APP_URL && new URL(Bun.env.APP_URL).protocol === 'https:') {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
  }
  catch {
    // Invalid deployment URLs are handled elsewhere; do not emit HSTS for them.
  }
  return headers
}

function secureCookie() {
  if (!Bun.env.APP_URL) return ''
  try {
    return new URL(Bun.env.APP_URL).protocol === 'https:' ? '; Secure' : ''
  }
  catch {
    return ''
  }
}

export function sessionCookie(value: string, maxAge = 30 * 24 * 60 * 60) {
  return `root=${value}; Max-Age=${maxAge}; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}

export function clearSessionCookie() {
  return sessionCookie('', 0)
}

const publicHtmlPaths = new Set(['/', '/hot', '/latest', '/explore', '/about', '/contact', '/dmca', '/legal', '/api'])
const publicHtmlPattern = /^\/(?:u\/[a-z0-9_]{2,24}|post\/[1-9]\d*|tag\/[a-z0-9_]+)$/i
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

export type FeedPreference = 'following' | 'hot' | 'latest'

export function feedPreference(request: Request): FeedPreference | null {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)feed=(following|hot|latest)(?:;|$)/)?.[1]
  return value as FeedPreference | undefined || null
}

export function feedPreferenceCookie(value: FeedPreference) {
  return `feed=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}
