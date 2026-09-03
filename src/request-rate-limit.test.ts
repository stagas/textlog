import { describe, expect, test } from 'bun:test'
import { NAVIGATION_CAPTCHA_LIFETIME_MS, NavigationCaptchaChallenges, NavigationCaptchaGate,
  nestedFromDepth } from './navigation-captcha'
import { CLIENT_ERROR_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_SECONDS, ClientErrorRateLimiter,
  HOURLY_REQUEST_BLOCK_SECONDS, HOURLY_REQUEST_RATE_LIMIT, HOURLY_REQUEST_RATE_WINDOW_SECONDS, rateLimitedResponse,
  rateLimitMessage, REQUEST_RATE_LIMIT, RequestRateLimiter } from './request-rate-limit'

describe('in-memory request rate limiter', () => {
  test('allows a modestly higher site-wide request burst', () => {
    expect(REQUEST_RATE_LIMIT).toBe(50)
  })

  test('defines a sustained hourly crawler limit and block', () => {
    expect(HOURLY_REQUEST_RATE_LIMIT).toBe(10_000)
    expect(HOURLY_REQUEST_RATE_WINDOW_SECONDS).toBe(3_600)
    expect(HOURLY_REQUEST_BLOCK_SECONDS).toBe(3_600)
  })

  test('hard-blocks an address after it exceeds the window allowance', () => {
    const limiter = new RequestRateLimiter({ limit: 3, windowSeconds: 10, blockSeconds: 60 })
    expect(limiter.consume('203.0.113.1', 1_000)).toBeNull()
    expect(limiter.consume('203.0.113.1', 2_000)).toBeNull()
    expect(limiter.consume('203.0.113.1', 3_000)).toBeNull()
    expect(limiter.consume('203.0.113.1', 4_000)).toEqual({ retryAfter: 60 })
    expect(limiter.consume('203.0.113.1', 34_000)).toEqual({ retryAfter: 30 })
    expect(limiter.consume('203.0.113.1', 64_000)).toBeNull()
  })

  test('isolates addresses and resets an ordinary expired window', () => {
    const limiter = new RequestRateLimiter({ limit: 1, windowSeconds: 10, blockSeconds: 60 })
    expect(limiter.consume('203.0.113.2', 1_000)).toBeNull()
    expect(limiter.consume('203.0.113.3', 2_000)).toBeNull()
    expect(limiter.consume('203.0.113.2', 11_000)).toBeNull()
  })

  test('bounds memory and fails closed for new addresses at capacity', () => {
    const limiter = new RequestRateLimiter({ limit: 10, windowSeconds: 10, blockSeconds: 60, maxAddresses: 2 })
    expect(limiter.consume('203.0.113.4', 1_000)).toBeNull()
    expect(limiter.consume('203.0.113.5', 1_000)).toBeNull()
    expect(limiter.consume('203.0.113.6', 1_000)).toEqual({ retryAfter: 60 })
    expect(limiter.consume('203.0.113.6', 61_001)).toBeNull()
  })

  test('does not create a shared bucket when an address cannot be resolved', () => {
    const limiter = new RequestRateLimiter({ limit: 1 })
    expect(limiter.consume('-', 1_000)).toBeNull()
    expect(limiter.consume('-', 1_000)).toBeNull()
  })

  test('returns a small non-cacheable 429 response', () => {
    const response = rateLimitedResponse(42)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('42')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('explains how long a visitor needs to wait', () => {
    expect(rateLimitMessage(42)).toContain('about 42 seconds')
    expect(rateLimitMessage(61)).toContain('about 2 minutes')
    expect(rateLimitMessage(3_600)).toContain('about 1 hour')
    expect(rateLimitMessage(3_661)).toContain('about 1 hour and 2 minutes')
  })
})

describe('client-error rate limiter', () => {
  test('allows ten client errors in five minutes and limits the eleventh', () => {
    expect(CLIENT_ERROR_RATE_LIMIT).toBe(10)
    expect(CLIENT_ERROR_RATE_WINDOW_SECONDS).toBe(300)
    const limiter = new ClientErrorRateLimiter()
    for (let count = 0; count < 10; count++) expect(limiter.record('203.0.113.10', 1_000 + count)).toBeNull()
    expect(limiter.record('203.0.113.10', 2_000)).toEqual({ retryAfter: 299 })
    expect(limiter.check('203.0.113.10', 3_000)).toEqual({ retryAfter: 298 })
    expect(limiter.check('203.0.113.10', 301_000)).toBeNull()
  })

  test('isolates addresses and only advances when a miss is recorded', () => {
    const limiter = new ClientErrorRateLimiter({ limit: 1, windowSeconds: 60 })
    expect(limiter.record('203.0.113.11', 1_000)).toBeNull()
    expect(limiter.check('203.0.113.11', 2_000)).toBeNull()
    expect(limiter.record('203.0.113.12', 2_000)).toBeNull()
    expect(limiter.record('203.0.113.11', 3_000)).toEqual({ retryAfter: 58 })
    expect(limiter.check('203.0.113.12', 3_000)).toBeNull()
  })

  test('does not share unresolved addresses or fail closed at capacity', () => {
    const limiter = new ClientErrorRateLimiter({ limit: 1, maxAddresses: 1 })
    expect(limiter.record('-', 1_000)).toBeNull()
    expect(limiter.record('-', 2_000)).toBeNull()
    expect(limiter.record('203.0.113.13', 1_000)).toBeNull()
    expect(limiter.record('203.0.113.14', 1_000)).toBeNull()
    expect(limiter.check('203.0.113.14', 2_000)).toBeNull()
  })
})

describe('nested navigation CAPTCHA', () => {
  const nested =
    'https://textlog.test/?from=%2Fpost%2F1071%3Ffrom%3D%252Fpost%252F1064%253Ffrom%253D%25252Fpost%25252F697%25253Ffrom%25253D%2525252Fpost%2525252F1066%2525253Ffrom%2525253D%252525252Flatest'
  const enterNext =
    'https://textlog.test/enter?next=%2Fpost%2F1577%3Ffrom%3D%252Fpost%252F925%253Ffrom%253D%25252Fpost%25252F1026%25253Ffrom%25253D%2525252Fpost%2525252F925'

  test('detects deeply nested from and enter next destinations', () => {
    expect(nestedFromDepth('https://textlog.test/post/1?from=%2Flatest')).toBe(1)
    expect(nestedFromDepth(nested)).toBe(4)
    expect(nestedFromDepth(enterNext)).toBe(4)
    expect(nestedFromDepth('https://textlog.test/latest')).toBe(0)
  })

  test('binds one-time challenges to an address and expiry', () => {
    const challenges = new NavigationCaptchaChallenges(() => ({ text: 'AbC123', data: '<svg />' }))
    const first = challenges.issue('203.0.113.20', 1_000)
    expect(challenges.consume('203.0.113.21', first.token, 'abc123', 2_000)).toBe(false)
    const second = challenges.issue('203.0.113.20', 1_000)
    expect(challenges.consume('203.0.113.20', second.token, ' abc123 ', 2_000)).toBe(true)
    expect(challenges.consume('203.0.113.20', second.token, 'abc123', 2_000)).toBe(false)
    const expired = challenges.issue('203.0.113.20', 1_000)
    expect(challenges.consume('203.0.113.20', expired.token, 'abc123', 1_000 + NAVIGATION_CAPTCHA_LIFETIME_MS)).toBe(
      false,
    )
  })

  test('keeps the triggering address gated until it passes or the UTC day changes', () => {
    const gate = new NavigationCaptchaGate()
    gate.require('203.0.113.20', new Date('2026-08-29T23:59:00Z'))
    expect(gate.check('203.0.113.20', new Date('2026-08-29T23:59:59Z'))).toBe(true)
    expect(gate.check('203.0.113.21', new Date('2026-08-29T23:59:59Z'))).toBe(false)
    gate.allow('203.0.113.20')
    expect(gate.check('203.0.113.20', new Date('2026-08-29T23:59:59Z'))).toBe(false)
    gate.require('203.0.113.20', new Date('2026-08-29T23:59:00Z'))
    expect(gate.check('203.0.113.20', new Date('2026-08-30T00:00:00Z'))).toBe(false)
  })
})
