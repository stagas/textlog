import { describe, expect, test } from 'bun:test'
import { applyHtmlCachePolicy, clearSessionCookie, feedPreference, feedPreferenceCookie, FORM_REQUEST_BODY_LIMIT,
  htmlCacheControl, isSameOriginRequest, limitedFormData, RequestBodyError, safeLocalPath, safeRefererPath,
  securityHeaders, sessionCookie, stringField } from './http'

describe('local redirects', () => {
  test('accepts local paths and rejects ambiguous or external targets', () => {
    expect(safeLocalPath('/activity?page=2')).toBe('/activity?page=2')
    expect(safeLocalPath('//evil.example/path')).toBe('/')
    expect(safeLocalPath('/\\evil.example')).toBe('/')
    expect(safeLocalPath('https://evil.example')).toBe('/')
  })

  test('only accepts same-origin referers', () => {
    const request = 'https://root.mx/follow/tester'
    expect(safeRefererPath('https://root.mx/explore?page=2', request, '/', null)).toBe('/explore?page=2')
    expect(safeRefererPath('https://evil.example/explore', request, '/', null)).toBe('/')
    expect(safeRefererPath('not a url', request, '/', null)).toBe('/')
  })
})

describe('request values and cookies', () => {
  test('accepts same-origin POSTs and rejects missing or cross-origin request metadata', () => {
    const url = 'https://root.mx/post'
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://root.mx' } }), null)).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { referer: 'https://root.mx/write' } }), null)).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://evil.example' } }), null)).toBe(false)
    expect(isSameOriginRequest(new Request(url), null)).toBe(false)
  })

  test('uses the configured public origin behind a proxy', () => {
    const request = new Request('http://internal:3000/post', { headers: { origin: 'https://root.mx' } })
    expect(isSameOriginRequest(request, 'https://root.mx')).toBe(true)
  })

  test('ignores uploaded files when a text field is expected', () => {
    const data = new FormData()
    data.set('body', new File(['text'], 'body.txt'))
    expect(stringField(data, 'body')).toBe('')
  })

  test('parses supported form bodies within the application limit', async () => {
    const request = new Request('https://root.mx/post', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'body=hello+root',
    })
    const data = await limitedFormData(request)
    expect(stringField(data, 'body')).toBe('hello root')
  })

  test('rejects oversized form bodies even without relying on content-length', async () => {
    const request = new Request('https://root.mx/post', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `body=${'x'.repeat(FORM_REQUEST_BODY_LIMIT)}`,
    })
    request.headers.delete('content-length')
    expect(limitedFormData(request)).rejects.toMatchObject({ status: 413, message: 'Payload Too Large' })
  })

  test('parses multipart forms and ignores file values', async () => {
    const body = new FormData()
    body.set('message', 'hello')
    body.set('attachment', new File(['text'], 'note.txt'))
    const data = await limitedFormData(new Request('https://root.mx/report', { method: 'POST', body }))
    expect(stringField(data, 'message')).toBe('hello')
    expect(stringField(data, 'attachment')).toBe('')
  })

  test('rejects unsupported form content types', async () => {
    const request = new Request('https://root.mx/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(limitedFormData(request)).rejects.toBeInstanceOf(RequestBodyError)
    expect(limitedFormData(new Request('https://root.mx/post', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'body=hello',
    }))).rejects.toMatchObject({ status: 415, message: 'Unsupported Media Type' })
  })

  test('hardens session cookies and enables Secure for HTTPS deployments', () => {
    expect(sessionCookie('token', undefined, 'http://localhost:3000')).toContain('HttpOnly; Path=/; SameSite=Lax')
    expect(sessionCookie('token', undefined, 'http://localhost:3000')).not.toContain('Secure')

    expect(sessionCookie('token', undefined, 'https://root.mx')).toContain('; Secure')
    expect(clearSessionCookie('https://root.mx')).toContain('Max-Age=0')
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
    expect(securityHeaders()['Content-Security-Policy']).toContain('script-src \'none\'')
    expect(securityHeaders(true)['Content-Security-Policy']).toContain('script-src \'self\' \'unsafe-inline\'')
    expect(securityHeaders()['X-Frame-Options']).toBe('DENY')
  })

  test('only emits HSTS for a configured HTTPS origin', () => {
    expect(securityHeaders(false, 'http://localhost:3000')['Strict-Transport-Security']).toBeUndefined()
    expect(securityHeaders(false, 'https://root.mx')['Strict-Transport-Security']).toContain('max-age=31536000')
  })
})

describe('HTML cache policy', () => {
  const html = () => new Response('page', { headers: { 'content-type': 'text/html' } })

  test('allows short shared caching for anonymous public pages', () => {
    const request = new Request('https://root.mx/u/alice?page=2')
    const response = html()
    applyHtmlCachePolicy(request, response)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=120')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('prevents storage for authenticated and sensitive pages', () => {
    expect(htmlCacheControl(new Request('https://root.mx/u/alice', { headers: { cookie: 'root=token' } }), html()))
      .toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://root.mx/login'), html())).toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://root.mx/post/1?reply=1'), html())).toBe('private, no-store')
  })

  test('prevents storage for errors, mutations, and responses that set cookies', () => {
    expect(htmlCacheControl(new Request('https://root.mx/post/1'), new Response('missing', { status: 404 })))
      .toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://root.mx/post/1', { method: 'POST', body: '' }), html()))
      .toBe('private, no-store')
    expect(
      htmlCacheControl(new Request('https://root.mx/latest'),
        new Response('page', { headers: { 'set-cookie': 'feed=latest' } })),
    ).toBe('private, no-store')
  })
})
