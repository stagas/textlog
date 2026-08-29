import { describe, expect, test } from 'bun:test'
import { CLIENT_ERROR_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_SECONDS, ClientErrorRateLimiter,
  HOURLY_REQUEST_BLOCK_SECONDS, HOURLY_REQUEST_RATE_LIMIT, HOURLY_REQUEST_RATE_WINDOW_SECONDS,
  rateLimitedResponse, rateLimitMessage, REQUEST_RATE_LIMIT, RequestRateLimiter } from './request-rate-limit'

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
