export const REQUEST_RATE_LIMIT = 50
export const REQUEST_RATE_WINDOW_SECONDS = 10
export const REQUEST_BLOCK_SECONDS = 5 * 60
export const HOURLY_REQUEST_RATE_LIMIT = 500
export const HOURLY_REQUEST_RATE_WINDOW_SECONDS = 60 * 60
export const HOURLY_REQUEST_BLOCK_SECONDS = 60 * 60
export const REQUEST_RATE_MAX_IPS = 50_000
export const CLIENT_ERROR_RATE_LIMIT = 10
export const CLIENT_ERROR_RATE_WINDOW_SECONDS = 5 * 60

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

export type ClientErrorRateLimitOptions = {
  limit?: number
  windowSeconds?: number
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

/** Tracks repeated 4xx responses without penalizing an address for valid requests. */
export class ClientErrorRateLimiter {
  private readonly entries = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly maxAddresses: number
  private operations = 0

  constructor(options: ClientErrorRateLimitOptions = {}) {
    this.limit = options.limit ?? CLIENT_ERROR_RATE_LIMIT
    this.windowMs = (options.windowSeconds ?? CLIENT_ERROR_RATE_WINDOW_SECONDS) * 1000
    this.maxAddresses = options.maxAddresses ?? REQUEST_RATE_MAX_IPS
  }

  check(address: string, now = Date.now()): { retryAfter: number } | null {
    if (!address || address === '-') return null
    if (++this.operations % 1024 === 0) this.removeExpired(now)

    const misses = this.entries.get(address)
    if (!misses) return null
    this.removeOldMisses(misses, now)
    if (misses.length === 0) {
      this.entries.delete(address)
      return null
    }
    return misses.length > this.limit ? this.retryAfter(misses, now) : null
  }

  record(address: string, now = Date.now()): { retryAfter: number } | null {
    if (!address || address === '-') return null
    let misses = this.entries.get(address)
    if (!misses) {
      if (this.entries.size >= this.maxAddresses) this.removeExpired(now)
      // Miss tracking is defensive; do not reject an unrelated new address if
      // a rotating-address attack fills the bounded map.
      if (this.entries.size >= this.maxAddresses) return null
      misses = []
      this.entries.set(address, misses)
    }

    this.removeOldMisses(misses, now)
    misses.push(now)
    return misses.length > this.limit ? this.retryAfter(misses, now) : null
  }

  private retryAfter(misses: number[], now: number) {
    return { retryAfter: Math.max(1, Math.ceil((misses[0] + this.windowMs - now) / 1000)) }
  }

  private removeOldMisses(misses: number[], now: number) {
    let count = 0
    while (count < misses.length && misses[count] <= now - this.windowMs) count++
    if (count) misses.splice(0, count)
  }

  private removeExpired(now: number) {
    for (const [address, misses] of this.entries) {
      this.removeOldMisses(misses, now)
      if (misses.length === 0) this.entries.delete(address)
    }
  }
}

export function rateLimitMessage(retryAfter: number) {
  const seconds = Math.max(1, Math.ceil(retryAfter))
  if (seconds < 60) {
    return `This connection has reached the site-wide request limit. Try again in about ${seconds} ${
      seconds === 1 ? 'second' : 'seconds'
    }.`
  }

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) {
    return `This connection has reached the site-wide request limit. Try again in about ${minutes} ${
      minutes === 1 ? 'minute' : 'minutes'
    }.`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  const wait = `${hours} ${hours === 1 ? 'hour' : 'hours'}${
    remainingMinutes ? ` and ${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}` : ''
  }`
  return `This connection has reached the site-wide request limit. Try again in about ${wait}.`
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
