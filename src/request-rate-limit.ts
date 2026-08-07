export const REQUEST_RATE_LIMIT = 20
export const REQUEST_RATE_WINDOW_SECONDS = 10
export const REQUEST_BLOCK_SECONDS = 5 * 60
export const REQUEST_RATE_MAX_IPS = 50_000

type Entry = {
  windowStartedAt: number
  requests: number
  blockedUntil: number
  lastSeenAt: number
}

export type RequestRateLimitOptions = {
  limit?: number
  windowSeconds?: number
  blockSeconds?: number
  maxAddresses?: number
}

/**
 * Process-local request circuit breaker. Addresses and counters live only in
 * memory and disappear when the process exits.
 */
export class RequestRateLimiter {
  private readonly entries = new Map<string, Entry>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly blockMs: number
  private readonly maxAddresses: number
  private operations = 0

  constructor(options: RequestRateLimitOptions = {}) {
    this.limit = options.limit ?? REQUEST_RATE_LIMIT
    this.windowMs = (options.windowSeconds ?? REQUEST_RATE_WINDOW_SECONDS) * 1000
    this.blockMs = (options.blockSeconds ?? REQUEST_BLOCK_SECONDS) * 1000
    this.maxAddresses = options.maxAddresses ?? REQUEST_RATE_MAX_IPS
  }

  consume(address: string, now = Date.now()): { retryAfter: number } | null {
    // Never put all unresolved clients into one shared bucket.
    if (!address || address === '-') return null

    if (++this.operations % 1024 === 0) this.removeExpired(now)
    let entry = this.entries.get(address)
    if (!entry) {
      if (this.entries.size >= this.maxAddresses) {
        this.removeExpired(now)
        // Fail closed without allocating when a rotating-address attack fills the map.
        if (this.entries.size >= this.maxAddresses) return { retryAfter: Math.ceil(this.blockMs / 1000) }
      }
      entry = { windowStartedAt: now, requests: 0, blockedUntil: 0, lastSeenAt: now }
      this.entries.set(address, entry)
    }

    entry.lastSeenAt = now
    if (entry.blockedUntil > now) return { retryAfter: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) }

    if (now - entry.windowStartedAt >= this.windowMs) {
      entry.windowStartedAt = now
      entry.requests = 0
      entry.blockedUntil = 0
    }
    entry.requests++
    if (entry.requests <= this.limit) return null

    entry.blockedUntil = now + this.blockMs
    return { retryAfter: Math.max(1, Math.ceil(this.blockMs / 1000)) }
  }

  private removeExpired(now: number) {
    const staleBefore = now - Math.max(this.windowMs, this.blockMs)
    for (const [address, entry] of this.entries) {
      if (entry.blockedUntil <= now && entry.lastSeenAt <= staleBefore) this.entries.delete(address)
    }
  }
}

export function rateLimitedResponse(retryAfter: number) {
  return new Response('Too Many Requests\n', {
    status: 429,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': String(retryAfter),
    },
  })
}
