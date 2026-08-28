import { describe, expect, test } from 'bun:test'
import { applyHtmlCachePolicy, canonicalizeCrawlerLinks, clearSessionCookie, crawlerCanonicalRedirect, feedPreference,
  feedPreferenceCookie, FORM_REQUEST_BODY_LIMIT, htmlCacheControl, isCrawlerRequest, isSameOriginRequest,
  limitedFormData, RequestBodyError, requiresSameOrigin, safeLocalPath, safeRefererPath, securityHeaders, sessionCookie,
  stringField } from './http'

describe('local redirects', () => {
  test('accepts local paths and rejects ambiguous or external targets', () => {
    expect(safeLocalPath('/activity?page=2')).toBe('/activity?page=2')
    expect(safeLocalPath('/latest?cursor=abc#post-42')).toBe('/latest?cursor=abc#post-42')
    expect(safeLocalPath('//evil.example/path')).toBe('/')
    expect(safeLocalPath('/\\evil.example')).toBe('/')
    expect(safeLocalPath('https://evil.example')).toBe('/')
  })

  test('only accepts same-origin referers', () => {
    const request = 'https://textlog.cc/follow/tester'
    expect(safeRefererPath('https://textlog.cc/explore?page=2', request, '/', null)).toBe('/explore?page=2')
    expect(safeRefererPath('https://evil.example/explore', request, '/', null)).toBe('/')
    expect(safeRefererPath('not a url', request, '/', null)).toBe('/')
  })

  test('redirects crawlers away from navigation-only from parameters', () => {
    const crawler = new Request('https://internal.test/post/42?page=2&from=%2Flatest%23post-42', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    })
    expect(isCrawlerRequest(crawler)).toBe(true)
    const response = crawlerCanonicalRedirect(crawler, 'https://textlog.cc')
    expect(response?.status).toBe(301)
    expect(response?.headers.get('location')).toBe('https://textlog.cc/post/42?page=2')
    expect(response?.headers.get('vary')).toBe('User-Agent')
    expect(response?.headers.get('cache-control')).toBe('private, no-store')

    const entry = crawlerCanonicalRedirect(new Request(
      'https://internal.test/enter?next=%2Fpost%2F42%3Freply%3D1%26from%3D%252Flatest%2523post-42',
      { headers: { 'user-agent': 'bingbot/2.0' } },
    ), 'https://textlog.cc')
    expect(entry?.headers.get('location')).toBe('https://textlog.cc/post/42')

    const passwordEntry = crawlerCanonicalRedirect(new Request(
      'https://internal.test/enter/password?next=%2Fpost%2F42%3Freply%3D1%26from%3D%252Flatest%2523post-42',
      { headers: { 'user-agent': 'Googlebot/2.1' } },
    ), 'https://textlog.cc')
    expect(passwordEntry?.headers.get('location')).toBe('https://textlog.cc/post/42')

    const meta = new Request('https://textlog.cc/post/42?from=%2Flatest', {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1)' },
    })
    expect(isCrawlerRequest(meta)).toBe(true)
    expect(crawlerCanonicalRedirect(meta, 'https://textlog.cc')?.headers.get('location'))
      .toBe('https://textlog.cc/post/42')

    const googleOther = new Request('https://textlog.cc/post/42?from=%2Flatest', {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) '
          + 'Chrome/150.0.7871.186 Mobile Safari/537.36 (compatible; GoogleOther)',
      },
    })
    expect(isCrawlerRequest(googleOther)).toBe(true)
    expect(crawlerCanonicalRedirect(googleOther, 'https://textlog.cc')?.headers.get('location'))
      .toBe('https://textlog.cc/post/42')

    const ahrefs = new Request('https://textlog.cc/post/42?from=%2Flatest', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)' },
    })
    expect(isCrawlerRequest(ahrefs)).toBe(true)
    expect(crawlerCanonicalRedirect(ahrefs, 'https://textlog.cc')?.headers.get('location'))
      .toBe('https://textlog.cc/post/42')
  })

  test('does not redirect people or crawler URLs without from', () => {
    expect(crawlerCanonicalRedirect(new Request('https://textlog.cc/post/42?from=%2Flatest', {
      headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1.15' },
    }))).toBeNull()
    expect(crawlerCanonicalRedirect(new Request('https://textlog.cc/post/42', {
      headers: { 'user-agent': 'bingbot/2.0' },
    }))).toBeNull()
  })

  test('removes direct and nested from parameters from links shown to crawlers', async () => {
    const request = new Request('https://textlog.cc/latest', { headers: { 'user-agent': 'Googlebot/2.1' } })
    const response = await canonicalizeCrawlerLinks(request, new Response(
      '<a href="/post/42?from=%2Flatest%23post-42">post</a>'
        + '<a href="/enter/password?next=%2Fpost%2F42%3Freply%3D1%26from%3D%252Flatest">reply</a>'
        + '<a href="https://example.com/?from=external">external</a>',
      { headers: { 'content-type': 'text/html;charset=utf-8' } },
    ))
    expect(await response.text()).toBe('<a href="/post/42">post</a>'
      + '<a href="/enter/password?next=%2Fpost%2F42%3Freply%3D1">reply</a>'
      + '<a href="https://example.com/?from=external">external</a>')
    expect(response.headers.get('vary')).toBe('User-Agent')
  })
})

describe('request values and cookies', () => {
  test('accepts same-origin POSTs and rejects missing or cross-origin request metadata', () => {
    const url = 'https://textlog.cc/post'
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://textlog.cc' } }), null)).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { referer: 'https://textlog.cc/write' } }), null)).toBe(true)
    expect(isSameOriginRequest(new Request(url, { headers: { origin: 'https://evil.example' } }), null)).toBe(false)
    expect(isSameOriginRequest(new Request(url), null)).toBe(false)
  })

  test('uses the configured public origin behind a proxy', () => {
    const request = new Request('http://internal:3000/post', { headers: { origin: 'https://textlog.cc' } })
    expect(isSameOriginRequest(request, 'https://textlog.cc')).toBe(true)
  })

  test('ignores uploaded files when a text field is expected', () => {
    const data = new FormData()
    data.set('body', new File(['text'], 'body.txt'))
    expect(stringField(data, 'body')).toBe('')
  })

  test('parses supported form bodies within the application limit', async () => {
    const request = new Request('https://textlog.cc/post', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'body=hello+textlog',
    })
    const data = await limitedFormData(request)
    expect(stringField(data, 'body')).toBe('hello textlog')
  })

  test('rejects oversized form bodies even without relying on content-length', async () => {
    const request = new Request('https://textlog.cc/post', {
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
    const data = await limitedFormData(new Request('https://textlog.cc/report', { method: 'POST', body }))
    expect(stringField(data, 'message')).toBe('hello')
    expect(stringField(data, 'attachment')).toBe('')
  })

  test('rejects unsupported form content types', async () => {
    const request = new Request('https://textlog.cc/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(limitedFormData(request)).rejects.toBeInstanceOf(RequestBodyError)
    expect(limitedFormData(new Request('https://textlog.cc/post', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'body=hello',
    }))).rejects.toMatchObject({ status: 415, message: 'Unsupported Media Type' })
  })

  test('hardens session cookies and enables Secure for HTTPS deployments', () => {
    expect(sessionCookie('token')).toContain('Max-Age=31536000')
    expect(sessionCookie('token', undefined, 'http://localhost:3000')).toContain('HttpOnly; Path=/; SameSite=Lax')
    expect(sessionCookie('token', undefined, 'http://localhost:3000')).not.toContain('Secure')

    expect(sessionCookie('token', undefined, 'https://textlog.cc')).toContain('; Secure')
    expect(clearSessionCookie('https://textlog.cc')).toContain('Max-Age=0')
  })

  test('stores and reads a valid feed preference', () => {
    expect(feedPreference(new Request('https://textlog.cc/', { headers: { cookie: 'textlog=token; feed=latest' } })))
      .toBe('latest')
    expect(feedPreference(new Request('https://textlog.cc/', { headers: { cookie: 'feed=activity' } })))
      .toBe('activity')
    expect(feedPreference(new Request('https://textlog.cc/', { headers: { cookie: 'feed=unknown' } }))).toBeNull()
    expect(feedPreferenceCookie('hot')).toContain('feed=hot; Max-Age=31536000; HttpOnly; Path=/; SameSite=Lax')
  })
})

describe('security headers', () => {
  test('disables scripts in production and only permits the inline development reloader in development', () => {
    expect(securityHeaders()['Content-Security-Policy']).toContain('script-src \'none\'')
    expect(securityHeaders()['Content-Security-Policy']).toContain('style-src \'self\' \'unsafe-inline\'')
    expect(securityHeaders()['Content-Security-Policy']).toContain('img-src \'self\' data: https:')
    expect(securityHeaders()['Content-Security-Policy']).toContain('media-src \'self\' https:')
    expect(securityHeaders(true)['Content-Security-Policy']).toContain('script-src \'self\' \'unsafe-inline\'')
    expect(securityHeaders()['X-Frame-Options']).toBe('DENY')
    expect(securityHeaders(false, undefined, true)['X-Frame-Options']).toBeUndefined()
    expect(securityHeaders(false, undefined, true)['Content-Security-Policy']).toContain('frame-ancestors *')
  })

  test('only emits HSTS for a configured HTTPS origin', () => {
    expect(securityHeaders(false, 'http://localhost:3000')['Strict-Transport-Security']).toBeUndefined()
    expect(securityHeaders(false, 'https://textlog.cc')['Strict-Transport-Security']).toContain('max-age=31536000')
  })
})

describe('HTML cache policy', () => {
  const html = () => new Response('page', { headers: { 'content-type': 'text/html' } })

  test('allows short shared caching for anonymous public pages', () => {
    const request = new Request('https://textlog.cc/u/alice?page=2')
    const response = html()
    applyHtmlCachePolicy(request, response)
    expect(response.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=120')
    expect(response.headers.get('vary')).toBe('User-Agent, Cookie')
  })

  test('prevents storage for authenticated and sensitive pages', () => {
    expect(
      htmlCacheControl(new Request('https://textlog.cc/u/alice', { headers: { cookie: 'textlog=token' } }), html()),
    )
      .toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://textlog.cc/login'), html())).toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://textlog.cc/post/1?reply=1'), html())).toBe('private, no-store')
  })

  test('prevents storage for errors, mutations, and responses that set cookies', () => {
    expect(htmlCacheControl(new Request('https://textlog.cc/post/1'), new Response('missing', { status: 404 })))
      .toBe('private, no-store')
    expect(htmlCacheControl(new Request('https://textlog.cc/post/1', { method: 'POST', body: '' }), html()))
      .toBe('private, no-store')
    expect(
      htmlCacheControl(new Request('https://textlog.cc/latest'),
        new Response('page', { headers: { 'set-cookie': 'feed=latest' } })),
    ).toBe('private, no-store')
  })
})

describe('same-origin enforcement', () => {
  test('guards browser form submissions', () => {
    expect(requiresSameOrigin('POST', '/post')).toBe(true)
    expect(requiresSameOrigin('POST', '/follow/alice')).toBe(true)
    expect(requiresSameOrigin('POST', '/install/banner/dismiss')).toBe(false)
    expect(requiresSameOrigin('GET', '/post')).toBe(false)
  })

  test('exempts the API, which authenticates with a bearer token', () => {
    // A native client sends neither Origin nor Referer, and a bearer token cannot be
    // attached by another site, so there is nothing to forge.
    expect(requiresSameOrigin('POST', '/api/v1/posts')).toBe(false)
    expect(requiresSameOrigin('DELETE', '/api/v1/posts/1')).toBe(false)
    expect(requiresSameOrigin('POST', '/api/v1/auth/verify')).toBe(false)
  })
})
