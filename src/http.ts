export function stringField(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
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
      "default-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data:",
      "style-src 'self'",
      devReload ? "script-src 'self' 'unsafe-inline'" : "script-src 'none'",
      "connect-src 'self'",
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

export type FeedPreference = 'following' | 'hot' | 'latest'

export function feedPreference(request: Request): FeedPreference | null {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)feed=(following|hot|latest)(?:;|$)/)?.[1]
  return value as FeedPreference | undefined || null
}

export function feedPreferenceCookie(value: FeedPreference) {
  return `feed=${value}; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; Path=/; SameSite=Lax${secureCookie()}`
}
