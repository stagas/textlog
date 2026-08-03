import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'

export const AUTH_LIMITS = {
  login: { attempts: 10, windowSeconds: 15 * 60 },
  signup: { attempts: 5, windowSeconds: 60 * 60 },
  forgotIp: { attempts: 5, windowSeconds: 60 * 60 },
  forgotAccount: { attempts: 3, windowSeconds: 60 * 60 },
  resetIp: { attempts: 10, windowSeconds: 60 * 60 },
  resetToken: { attempts: 5, windowSeconds: 60 * 60 },
  sensitiveAccount: { attempts: 5, windowSeconds: 15 * 60 },
} as const

export function rateLimitKey(value: string) {
  return createHash('sha256').update(`root.mx auth rate limit\0${value}`).digest('hex')
}

export function consumeAuthAttempt(
  database: Database,
  scope: string,
  keyHash: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
) {
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

export function authRateLimitMessage(retryAfter: number) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60))
  return `Too many attempts. Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}
