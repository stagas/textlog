import type { Database } from 'bun:sqlite'
import type { Context, Hono } from 'hono'
import { accountForEmail, markGroupEmailVerified, selectAccount } from '../account-groups'
import { softDeletePost } from '../admin'
import { apiOrigin, apiPost } from '../api'
import { AUTH_LIMITS, consumeAuthAttempt, consumeBucketedAttempt, rateLimitKey } from '../auth-rate-limit'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from '../bio-body'
import type { User } from '../db'
import { sendMagicLink } from '../email'
import { resolveHandle } from '../handles'
import { logError } from '../log'
import { deleteLinkPreviewImages, discoverLinkPreviews, replaceBioLinkPreviews, replaceLinkPreviews,
  saveLinkPreviews } from '../link-preview'
import { moderateText, moderationMessage } from '../moderation'
import { normalizePostBody, POST_MAX, postBodyValidationMessage, validPostBody } from '../post-body'
import { postRateLimitMessage } from '../post-rate-limit'
import { canPublishPosts } from '../posting-policy'
import { createPost, updatePost } from '../posts'
import { sendPushForFollow, sendPushForPost, sendPushForUserFollow } from '../push'
import { insertSession, SESSION_LIFETIME_MS, sessionHash } from '../sessions'
import { apiUser, bearerToken, hash, token } from '../utils'
import { emailPattern } from './auth'
import { clientAddress, issueMagicLink, usersBlocked } from './shared'

export const CODE_ATTEMPT_LIMIT = 5
export const WRITE_LIMIT = 60
export const WRITE_WINDOW_SECONDS = 60 * 60
export { BIO_MAX } from '../bio-body'
export { POST_MAX } from '../post-body'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(code: string, message: string, status: number, retryAfter?: number) {
  const response = json({ error: { code, message } }, status)
  if (retryAfter !== undefined) response.headers.set('retry-after', String(retryAfter))
  return response
}

async function body(c: Context) {
  try {
    const value = await c.req.json()
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

const text = (value: unknown) => typeof value === 'string' ? value : ''

/**
 * Every write goes through here. Posting also passes through the same rate limit,
 * duplicate window and moderation as the web forms, so the API is never a way around
 * a rule the site already enforces.
 */
function writer(database: Database, c: Context) {
  const user = apiUser(c.req.raw, database)
  if (!user) return { error: fail('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401) }
  const limited = consumeBucketedAttempt(database, 'api-write', rateLimitKey(`user:${user.id}`), WRITE_LIMIT,
    WRITE_WINDOW_SECONDS)
  if (limited) return { error: fail('rate_limited', 'Too many writes', 429, limited.retryAfter) }
  return { user }
}

function serialize(user: User) {
  return {
    handle: user.handle.toLowerCase(),
    email: user.email,
    bio: user.bio,
    email_verified: Boolean(user.email_verified_at),
    can_post: canPublishPosts(user),
  }
}

export function registerApiWriteRoutes(app: Hono, database: Database, appUrl?: string | null) {
  app.post('/api/v1/auth/request', async c => {
    const payload = await body(c)
    const email = text(payload?.email).trim().toLowerCase()
    if (!emailPattern.test(email) || email.length > 254) {
      return fail('invalid_email', 'Enter a valid email address', 400)
    }
    const ipLimited = consumeAuthAttempt(database, 'api-auth-ip', rateLimitKey(clientAddress(c)),
      AUTH_LIMITS.loginIp.attempts, AUTH_LIMITS.loginIp.windowSeconds)
    if (ipLimited) return fail('rate_limited', 'Too many sign in attempts', 429, ipLimited.retryAfter)
    const emailLimited = consumeAuthAttempt(database, 'api-auth-email', rateLimitKey(email),
      AUTH_LIMITS.forgotAccount.attempts, AUTH_LIMITS.forgotAccount.windowSeconds)
    if (emailLimited) return fail('rate_limited', 'Too many sign in attempts', 429, emailLimited.retryAfter)

    // Accounts are only ever created in a browser. An unknown address gets the same
    // answer as a known one so the API cannot be used to discover who has an account.
    const account = accountForEmail(database, email)
    if (account?.handle_chosen_at) {
      const origin = apiOrigin(c.req.url, appUrl)
      const link = issueMagicLink(email, account.id, '/', origin, database)
      try {
        await sendMagicLink(email, link.url, link.code, account.handle)
      }
      catch {
        return fail('email_failed', 'The code could not be sent. Please try again later', 503)
      }
    }
    return json({ data: { sent: true } }, 202)
  })

  app.post('/api/v1/auth/verify', async c => {
    const payload = await body(c)
    const email = text(payload?.email).trim().toLowerCase()
    const code = text(payload?.code).trim()
    if (!emailPattern.test(email) || !/^\d{6}$/.test(code)) {
      return fail('invalid_code', 'That code is invalid or has expired', 400)
    }
    const limited = consumeAuthAttempt(database, 'api-auth-verify', rateLimitKey(`${email}:${clientAddress(c)}`),
      AUTH_LIMITS.resetToken.attempts, AUTH_LIMITS.resetToken.windowSeconds)
    if (limited) return fail('rate_limited', 'Too many attempts', 429, limited.retryAfter)

    const link = database.query(`SELECT token_hash,user_id,attempts FROM magic_links
      WHERE email=? AND code_hash IS NOT NULL AND expires_at>?`)
      .get(email, Date.now()) as { token_hash: string; user_id: number | null; attempts: number } | null
    const match = link && database.query('SELECT 1 FROM magic_links WHERE token_hash=? AND code_hash=?')
      .get(link.token_hash, hash(code))
    const accountReady = link?.user_id && database.query(`SELECT 1 FROM users WHERE id=?
      AND handle_chosen_at IS NOT NULL AND deleted_at IS NULL AND suspended_at IS NULL`).get(link.user_id)
    if (!link || !link.user_id || !accountReady || !match) {
      if (link) {
        const attempts = link.attempts + 1
        if (attempts >= CODE_ATTEMPT_LIMIT) {
          database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
        }
        else database.query('UPDATE magic_links SET attempts=? WHERE token_hash=?').run(attempts, link.token_hash)
      }
      return fail('invalid_code', 'That code is invalid or has expired', 400)
    }

    const session = token()
    const expiresAt = Date.now() + SESSION_LIFETIME_MS
    database.transaction(() => {
      database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
      markGroupEmailVerified(database, link.user_id!)
      if (!selectAccount(database, link.user_id!)) throw new Error('Account is unavailable')
      insertSession(database, session, link.user_id!, expiresAt, Date.now(), c.req.header('user-agent') || '')
    })()
    const user = database.query(`SELECT id,handle,email,bio,email_verified_at
      FROM users WHERE id=?`).get(link.user_id) as User
    return json({ data: { token: session, expires_at: new Date(expiresAt).toISOString(), user: serialize(user) } })
  })

  app.delete('/api/v1/auth/session', c => {
    const tokenHash = sessionHash(bearerToken(c.req.raw))
    if (!tokenHash) return fail('unauthorized', 'Provide a bearer token', 401)
    database.query('DELETE FROM sessions WHERE token_hash=?').run(tokenHash)
    return json({ data: { revoked: true } })
  })

  app.get('/api/v1/me', c => {
    const user = apiUser(c.req.raw, database)
    if (!user) return fail('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    return json({ data: serialize(user) })
  })

  app.patch('/api/v1/me', async c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const payload = await body(c)
    const bio = normalizeBioBody(text(payload?.bio).trim())
    if (!validBioBody(bio)) return fail('invalid_bio', bioBodyValidationMessage(bio), 400)
    if (bio) {
      const moderation = await moderateText(`bio: ${bio}`)
      if (!moderation.ok) {
        return fail(moderation.reason === 'flagged' ? 'flagged' : 'unavailable', moderationMessage(moderation.reason),
          moderation.reason === 'flagged' ? 422 : 503)
      }
    }
    database.query('UPDATE users SET bio=? WHERE id=?').run(bio, guard.user!.id)
    await replaceBioLinkPreviews(database, guard.user!.id, await discoverLinkPreviews(bio, database))
    return json({ data: { ...serialize(guard.user!), bio } })
  })

  app.post('/api/v1/posts', async c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const user = guard.user!
    if (!canPublishPosts(user)) return fail('email_unverified', 'Verify your email address before posting', 403)

    const payload = await body(c)
    const content = normalizePostBody(text(payload?.body))
    if (!validPostBody(content)) {
      return fail('invalid_body', postBodyValidationMessage(content), 400)
    }
    let parentId: number | null = null
    if (payload?.parent_id !== undefined && payload?.parent_id !== null) {
      parentId = Number(payload.parent_id)
      if (!Number.isInteger(parentId) || parentId < 1) {
        return fail('invalid_parent', 'Parent must be a post id', 400)
      }
      const parent = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
        .get(parentId) as { user_id: number } | null
      if (!parent) return fail('not_found', 'Post not found', 404)
      if (usersBlocked(user.id, parent.user_id, database)) return fail('not_found', 'Post not found', 404)
    }

    const moderation = await moderateText(content)
    if (!moderation.ok) {
      return fail(moderation.reason === 'flagged' ? 'flagged' : 'unavailable', moderationMessage(moderation.reason),
        moderation.reason === 'flagged' ? 422 : 503)
    }

    const result = createPost(database, user.id, content, parentId)
    if ('retryAfter' in result) {
      return fail('post_rate_limited', postRateLimitMessage(result.retryAfter), 429, result.retryAfter)
    }
    if (!result.duplicate) await saveLinkPreviews(database, result.id, await discoverLinkPreviews(content, database))
    if (!result.duplicate) {
      void sendPushForPost(result.id, user.id, user.handle, database)
        .catch(error => logError('API activity push failed', error))
    }
    const created = apiPost(database, result.id, apiOrigin(c.req.url, appUrl))
    return json({ data: created }, result.duplicate ? 200 : 201)
  })

  app.patch('/api/v1/posts/:id', async c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
    const post = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
      .get(id) as { user_id: number } | null
    if (!post) return fail('not_found', 'Post not found', 404)
    if (post.user_id !== guard.user!.id) return fail('forbidden', 'That post belongs to someone else', 403)

    const payload = await body(c)
    const content = normalizePostBody(text(payload?.body))
    if (!validPostBody(content)) {
      return fail('invalid_body', postBodyValidationMessage(content), 400)
    }
    const moderation = await moderateText(content)
    if (!moderation.ok) {
      return fail(moderation.reason === 'flagged' ? 'flagged' : 'unavailable', moderationMessage(moderation.reason),
        moderation.reason === 'flagged' ? 422 : 503)
    }
    updatePost(database, id, content)
    await replaceLinkPreviews(database, id, await discoverLinkPreviews(content, database))
    return json({ data: apiPost(database, id, apiOrigin(c.req.url, appUrl)) })
  })

  app.delete('/api/v1/posts/:id', async c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
    const post = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
      .get(id) as { user_id: number } | null
    if (!post) return fail('not_found', 'Post not found', 404)
    if (post.user_id !== guard.user!.id) return fail('forbidden', 'That post belongs to someone else', 403)
    database.transaction(() => softDeletePost(database, id))()
    await deleteLinkPreviewImages(database, id)
    return json({ data: { deleted: true } })
  })

  function target(c: Context, userId: number) {
    const handle = (c.req.param('handle') || '').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return { error: fail('invalid_handle', 'Handle is invalid', 400) }
    const found = resolveHandle(database, handle)
    if (!found) return { error: fail('not_found', 'User not found', 404) }
    if (found.id === userId) return { error: fail('forbidden', 'That is your own account', 403) }
    return { id: found.id, handle: found.handle }
  }

  app.post('/api/v1/users/:handle/follow', c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const other = target(c, guard.user!.id)
    if (other.error || !other.id) return other.error ?? fail('not_found', 'User not found', 404)
    if (usersBlocked(guard.user!.id, other.id, database)) return fail('not_found', 'User not found', 404)
    const inserted = database.query(`INSERT OR IGNORE INTO follows(follower_id,following_id,created_at)
      VALUES(?,?,CURRENT_TIMESTAMP)`).run(guard.user!.id, other.id)
    if (inserted.changes) {
      void sendPushForFollow(guard.user!.id, guard.user!.handle, other.id, database)
        .catch(error => logError('API follow push failed', error))
      void sendPushForUserFollow(guard.user!.id, guard.user!.handle, other.id, other.handle, database)
        .catch(error => logError('API follow activity push failed', error))
    }
    return json({ data: { following: true } })
  })

  app.delete('/api/v1/users/:handle/follow', c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const other = target(c, guard.user!.id)
    if (other.error || !other.id) return other.error ?? fail('not_found', 'User not found', 404)
    database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(guard.user!.id, other.id)
    return json({ data: { following: false } })
  })

  app.post('/api/v1/users/:handle/block', c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const other = target(c, guard.user!.id)
    if (other.error || !other.id) return other.error ?? fail('not_found', 'User not found', 404)
    database.transaction(() => {
      database.query('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id) VALUES(?,?)')
        .run(guard.user!.id, other.id)
      database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(guard.user!.id, other.id)
    })()
    return json({ data: { blocked: true } })
  })

  app.delete('/api/v1/users/:handle/block', c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const other = target(c, guard.user!.id)
    if (other.error || !other.id) return other.error ?? fail('not_found', 'User not found', 404)
    database.query('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(guard.user!.id, other.id)
    return json({ data: { blocked: false } })
  })

  app.post('/api/v1/posts/:id/report', async c => {
    const guard = writer(database, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
    const post = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
      .get(id) as { user_id: number } | null
    if (!post) return fail('not_found', 'Post not found', 404)
    if (post.user_id === guard.user!.id) return fail('forbidden', 'You cannot report your own post', 400)
    const payload = await body(c)
    const reason = text(payload?.reason)
    if (!['harassment', 'spam', 'impersonation', 'other'].includes(reason)) {
      return fail('invalid_reason', 'Reason must be harassment, spam, impersonation or other', 400)
    }
    database.query(`INSERT INTO reports(reporter_id,post_id,reason) VALUES(?,?,?)
      ON CONFLICT(reporter_id,post_id) DO UPDATE SET reason=excluded.reason,created_at=CURRENT_TIMESTAMP`)
      .run(guard.user!.id, id, reason)
    return json({ data: { reported: true } })
  })
}
