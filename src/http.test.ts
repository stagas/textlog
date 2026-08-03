import { afterEach, describe, expect, test } from 'bun:test'
import { clearSessionCookie, feedPreference, feedPreferenceCookie, isSameOriginRequest, safeLocalPath, safeRefererPath,
  securityHeaders, sessionCookie, stringField } from './http'

const previousAppUrl = Bun.env.APP_URL
afterEach(() => {
  if (previousAppUrl === undefined) delete Bun.env.APP_URL
  else Bun.env.APP_URL = previousAppUrl
})

describe('local redirects', () => {
  test('accepts local paths and rejects ambiguous or external targets', () => {
    expect(safeLocalPath('/activity?page=2')).toBe('/activity?page=2')
    expect(safeLocalPath('//evil.example/path')).toBe('/')
    expect(safeLocalPath('/\\evil.example')).toBe('/')
    expect(safeLocalPath('https://evil.example')).toBe('/')
  })

  test('only accepts same-origin referers', () => {
    const request = 'https://root.mx/follow/tester'
    expect(safeRefererPath('https://root.mx/explore?page=2', request)).toBe('/explore?page=2')
    expect(safeRefererPath('https://evil.example/explore', request)).toBe('/')
    expect(safeRefererPath('not a url', request)).toBe('/')
  })
})

describe('request values and cookies', () => {
  test('accepts same-origin POSTs and rejects missing or cross-origin request metadata', () => {
    const url = 'https://root.mx/post'
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://root.mx' } }))).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { referer: 'https://root.mx/compose' } }))).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://evil.example' } }))).toBe(false)
    expect(isSameOriginRequest(new Request(url))).toBe(false)
  })

  test('uses the configured public origin behind a proxy', () => {
    Bun.env.APP_URL = 'https://root.mx'
    const request = new Request('http://internal:3000/post', { headers: { origin: 'https://root.mx' } })
    expect(isSameOriginRequest(request)).toBe(true)
  })

  test('ignores uploaded files when a text field is expected', () => {
    const data = new FormData()
    data.set('body', new File(['text'], 'body.txt'))
    expect(stringField(data, 'body')).toBe('')
  })

  test('hardens session cookies and enables Secure for HTTPS deployments', () => {
    Bun.env.APP_URL = 'http://localhost:3000'
    expect(sessionCookie('token')).toContain('HttpOnly; Path=/; SameSite=Lax')
    expect(sessionCookie('token')).not.toContain('Secure')

    Bun.env.APP_URL = 'https://root.mx'
    expect(sessionCookie('token')).toContain('; Secure')
    expect(clearSessionCookie()).toContain('Max-Age=0')
  })

  test('stores and reads a valid feed preference', () => {
    expect(feedPreference(new Request('https://root.mx/', { headers: { cookie: 'root=token; feed=latest' } })))
      .toBe('latest')
    expect(feedPreference(new Request('https://root.mx/', { headers: { cookie: 'feed=unknown' } }))).toBeNull()
    expect(feedPreferenceCookie('hot')).toContain('feed=hot; Max-Age=31536000; HttpOnly; Path=/; SameSite=Lax')
  })
})

describe('security headers', () => {
  test('disables scripts in production and only permits the inline development reloader in development', () => {
    expect(securityHeaders()['Content-Security-Policy']).toContain("script-src 'none'")
    expect(securityHeaders(true)['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'")
    expect(securityHeaders()['X-Frame-Options']).toBe('DENY')
  })

  test('only emits HSTS for a configured HTTPS origin', () => {
    Bun.env.APP_URL = 'http://localhost:3000'
    expect(securityHeaders()['Strict-Transport-Security']).toBeUndefined()
    Bun.env.APP_URL = 'https://root.mx'
    expect(securityHeaders()['Strict-Transport-Security']).toContain('max-age=31536000')
  })
})
