import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { isDevelopment } from './environment'

export const AUTH_LIMITS = {
  loginIp: { attempts: 10, windowSeconds: 15 * 60 },
  loginSubnet: { attempts: 20, windowSeconds: 15 * 60 },
  loginAccount: { attempts: 10, windowSeconds: 15 * 60 },
  signup: { attempts: 5, windowSeconds: 60 * 60 },
  forgotIp: { attempts: 5, windowSeconds: 60 * 60 },
  forgotAccount: { attempts: 3, windowSeconds: 60 * 60 },
  resetIp: { attempts: 10, windowSeconds: 60 * 60 },
  resetToken: { attempts: 5, windowSeconds: 60 * 60 },
  sensitiveAccount: { attempts: 5, windowSeconds: 15 * 60 },
  illegalReportIp: { attempts: 5, windowSeconds: 60 * 60 },
} as const

/** Groups login sources without storing the address: IPv4 /24 and IPv6 /64. */
export function loginSubnet(address: string) {
  const raw = address.trim().toLowerCase().split('%')[0]
  if (isIP(raw) === 4) {
    const octets = raw.split('.').map(Number)
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
  }
  if (isIP(raw) !== 6) return raw || 'unknown'

  let ipv6 = raw
  if (ipv6.includes('.')) {
    const lastColon = ipv6.lastIndexOf(':')
    const octets = ipv6.slice(lastColon + 1).split('.').map(Number)
    ipv6 = `${ipv6.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${
      ((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const [left = '', right = ''] = ipv6.split('::')
  const leftGroups = left ? left.split(':') : []
  const rightGroups = right ? right.split(':') : []
  const groups = ipv6.includes('::')
    ? [...leftGroups, ...Array(8 - leftGroups.length - rightGroups.length).fill('0'), ...rightGroups]
    : leftGroups
  const values = groups.map(group => Number.parseInt(group, 16))

  // Treat IPv4-mapped IPv6 addresses as IPv4 so both representations share a bucket.
  if (values.slice(0, 5).every(value => value === 0) && values[5] === 0xffff) {
    const octets = [values[6] >> 8, values[6] & 0xff, values[7] >> 8, values[7] & 0xff]
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
  }
  return `${values.slice(0, 4).map(value => value.toString(16)).join(':')}::/64`
}

export function rateLimitKey(value: string) {
  return createHash('sha256').update(`textlog auth rate limit\0${value}`).digest('hex')
}

export function consumeAuthAttempt(
  database: Database,
  scope: string,
  keyHash: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
) {
  if (isDevelopment()) return null
  return database.transaction(() => {
    const cutoff = now - windowSeconds * 1000
    database.query('DELETE FROM auth_rate_limits WHERE scope=? AND key_hash=? AND created_at<=?')
      .run(scope, keyHash, cutoff)
    const attempts = database.query(
      'SELECT count(*) count,min(created_at) oldest FROM auth_rate_limits WHERE scope=? AND key_hash=?',
    ).get(scope, keyHash) as { count: number; oldest: number | null }
    if (attempts.count >= limit && attempts.oldest !== null) {
      return { retryAfter: Math.max(1, Math.ceil((attempts.oldest + windowSeconds * 1000 - now) / 1000)) }
    }
    database.query('INSERT INTO auth_rate_limits(scope,key_hash,created_at) VALUES(?,?,?)').run(scope, keyHash, now)
    return null
  })()
}

export function consumeBucketedAttempt(
  database: Database,
  scope: string,
  keyHash: string,
  limit: number,
  bucketSeconds: number,
  now = Date.now(),
) {
  if (isDevelopment()) return null
  const bucketMs = bucketSeconds * 1000
  const bucketStart = Math.floor(now / bucketMs) * bucketMs
  return database.transaction(() => {
    const current = database.query(
      'SELECT count FROM api_rate_limit_buckets WHERE scope=? AND key_hash=? AND bucket_start=?',
    ).get(scope, keyHash, bucketStart) as { count: number } | null
    if (current && current.count >= limit) {
      return { retryAfter: Math.max(1, Math.ceil((bucketStart + bucketMs - now) / 1000)) }
    }
    database.query(`INSERT INTO api_rate_limit_buckets(scope,key_hash,bucket_start,count) VALUES(?,?,?,1)
      ON CONFLICT(scope,key_hash,bucket_start) DO UPDATE SET count=count+1`)
      .run(scope, keyHash, bucketStart)
    return null
  })()
}

export function authRateLimitMessage(retryAfter: number) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60))
  return `Too many attempts. Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}
