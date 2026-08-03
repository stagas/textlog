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
