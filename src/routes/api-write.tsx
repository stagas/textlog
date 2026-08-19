import type { Context, Hono } from 'hono'
import { apiOrigin } from '../api'
import { publishPost } from '../api-broker'
import { AUTH_LIMITS } from '../auth-rate-limit'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from '../bio-body'
import type { DatabaseService } from '../database-service'
import { sendMagicLink } from '../email'
import { deleteImages, deleteImagesAfterCommit } from '../image-storage'
import { discoverLinkPreviews } from '../link-preview'
import { logError } from '../log'
import { moderateText, moderationMessage } from '../moderation'
import { normalizePostBody, POST_MAX, postBodyValidationMessage, validPostBody } from '../post-body'
import { postRateLimitMessage } from '../post-rate-limit'
import { canPublishPosts } from '../posting-policy'
import { sendPushForFollow, sendPushForPost, sendPushForUserFollow } from '../push'
import { sessionHash } from '../sessions'
import type { User } from '../types'
import { bearerToken } from '../utils'
import { emailPattern } from './auth'
import { clientAddress } from './shared'

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
async function writer(service: DatabaseService, requestApiUser: (request: Request) => User | null, c: Context) {
  const user = requestApiUser(c.req.raw)
  if (!user) return { error: fail('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401) }
  const limited = await service.call('system.consumeBucketedAttempt', { scope: 'api-write', identity: `user:${user.id}`,
    attempts: WRITE_LIMIT, bucketSeconds: WRITE_WINDOW_SECONDS, now: Date.now() })
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

async function persistPostPreviews(service: DatabaseService, postId: number, mode: 'save' | 'replace',
  previews: Awaited<ReturnType<typeof discoverLinkPreviews>>)
{
  const newKeys = previews.flatMap(preview => 'imageKey' in preview && preview.imageKey ? [preview.imageKey] : [])
  try {
    const result = await service.call('api.persistPostPreviews', { postId, mode, previews })
    await deleteImagesAfterCommit(result.obsoleteImageKeys)
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
}

async function persistBioPreviews(service: DatabaseService, userId: number,
  previews: Awaited<ReturnType<typeof discoverLinkPreviews>>)
{
  const newKeys = previews.flatMap(preview => 'imageKey' in preview && preview.imageKey ? [preview.imageKey] : [])
  try {
    const result = await service.call('api.persistBioPreviews', { userId, previews })
    await deleteImagesAfterCommit(result.obsoleteImageKeys)
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
}

export function registerApiWriteRoutes(app: Hono, service: DatabaseService,
  requestApiUser: (request: Request) => User | null, appUrl?: string | null)
{
  app.post('/api/v1/auth/request', async c => {
    const payload = await body(c)
    const email = text(payload?.email).trim().toLowerCase()
    if (!emailPattern.test(email) || email.length > 254) {
      return fail('invalid_email', 'Enter a valid email address', 400)
    }
    const ipLimited = await service.call('system.consumeAuthAttempt', { scope: 'api-auth-ip',
      identity: clientAddress(c), attempts: AUTH_LIMITS.loginIp.attempts,
      windowSeconds: AUTH_LIMITS.loginIp.windowSeconds, now: Date.now() })
    if (ipLimited) return fail('rate_limited', 'Too many sign in attempts', 429, ipLimited.retryAfter)
    const emailLimited = await service.call('system.consumeAuthAttempt', { scope: 'api-auth-email', identity: email,
      attempts: AUTH_LIMITS.forgotAccount.attempts, windowSeconds: AUTH_LIMITS.forgotAccount.windowSeconds,
      now: Date.now() })
    if (emailLimited) return fail('rate_limited', 'Too many sign in attempts', 429, emailLimited.retryAfter)

    // Accounts are only ever created in a browser. An unknown address gets the same
    // answer as a known one so the API cannot be used to discover who has an account.
    const link = await service.call('api.requestSignIn', { email, origin: apiOrigin(c.req.url, appUrl),
      now: Date.now() })
    if (link) {
      try {
        await sendMagicLink(email, link.url, link.code, link.handle)
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
    const now = Date.now()
    const limited = await service.call('system.consumeAuthAttempt', { scope: 'api-auth-verify',
      identity: `${email}:${clientAddress(c)}`, attempts: AUTH_LIMITS.resetToken.attempts,
      windowSeconds: AUTH_LIMITS.resetToken.windowSeconds, now })
    if (limited) return fail('rate_limited', 'Too many attempts', 429, limited.retryAfter)

    const result = await service.call('api.verifySignIn', {
      email,
      code,
      userAgent: c.req.header('user-agent') || '',
      now,
    })
    if (result.status === 'invalid') return fail('invalid_code', 'That code is invalid or has expired', 400)
    return json({
      data: { token: result.token, expires_at: new Date(result.expiresAt).toISOString(), user: serialize(result.user) },
    })
  })

  app.delete('/api/v1/auth/session', async c => {
    const tokenHash = sessionHash(bearerToken(c.req.raw))
    if (!tokenHash) return fail('unauthorized', 'Provide a bearer token', 401)
    const user = requestApiUser(c.req.raw)
    if (!user) return fail('unauthorized', 'Provide a bearer token', 401)
    await service.call('account.revokeSession', { userId: user.id, tokenHash, currentSessionHash: null })
    return json({ data: { revoked: true } })
  })

  app.get('/api/v1/me', c => {
    const user = requestApiUser(c.req.raw)
    if (!user) return fail('unauthorized', 'Provide a bearer token from /api/v1/auth/verify', 401)
    return json({ data: serialize(user) })
  })

  app.patch('/api/v1/me', async c => {
    const guard = await writer(service, requestApiUser, c)
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
    await service.call('api.updateBio', { userId: guard.user!.id, bio })
    await persistBioPreviews(service, guard.user!.id, await discoverLinkPreviews(bio))
    return json({ data: { ...serialize(guard.user!), bio } })
  })

  app.post('/api/v1/posts', async c => {
    const guard = await writer(service, requestApiUser, c)
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
    }

    const moderation = await moderateText(content)
    if (!moderation.ok) {
      return fail(moderation.reason === 'flagged' ? 'flagged' : 'unavailable', moderationMessage(moderation.reason),
        moderation.reason === 'flagged' ? 422 : 503)
    }

    const result = await service.call('api.createPost', {
      userId: user.id,
      body: content,
      parentId,
      origin: apiOrigin(c.req.url, appUrl),
    })
    if (result.status === 'not_found') return fail('not_found', 'Post not found', 404)
    if (result.status === 'rate_limited') {
      return fail('post_rate_limited', postRateLimitMessage(result.retryAfter), 429, result.retryAfter)
    }
    if (!result.duplicate) publishPost(result.id)
    if (!result.duplicate) await persistPostPreviews(service, result.id, 'save', await discoverLinkPreviews(content))
    if (!result.duplicate) {
      void sendPushForPost(result.id, user.id, user.handle, undefined, undefined, service)
        .catch(error => logError('API activity push failed', error))
    }
    return json({ data: result.post }, result.duplicate ? 200 : 201)
  })

  app.patch('/api/v1/posts/:id', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
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
    const result = await service.call('api.updatePost', {
      userId: guard.user!.id,
      id,
      body: content,
      origin: apiOrigin(c.req.url, appUrl),
    })
    if (result.status !== 'ready') {
      return result.status === 'not_found'
        ? fail('not_found', 'Post not found', 404)
        : fail('forbidden', 'That post belongs to someone else', 403)
    }
    await persistPostPreviews(service, id, 'replace', await discoverLinkPreviews(content))
    return json({ data: result.post })
  })

  app.delete('/api/v1/posts/:id', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
    const result = await service.call('api.deletePost', { userId: guard.user!.id, id })
    if (result.status !== 'ready') {
      return result.status === 'not_found'
        ? fail('not_found', 'Post not found', 404)
        : fail('forbidden', 'That post belongs to someone else', 403)
    }
    await deleteImagesAfterCommit(result.imageKeys)
    return json({ data: { deleted: true } })
  })

  app.post('/api/v1/users/:handle/follow', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const handle = (c.req.param('handle') || '').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return fail('invalid_handle', 'Handle is invalid', 400)
    const other = await service.call('api.relationshipMutation', { userId: guard.user!.id, handle, action: 'follow' })
    if (other.status === 'self') return fail('forbidden', 'That is your own account', 403)
    if (other.status !== 'ready') return fail('not_found', 'User not found', 404)
    if (other.changed) {
      void sendPushForFollow(guard.user!.id, guard.user!.handle, other.targetId, undefined, undefined, service)
        .catch(error => logError('API follow push failed', error))
      void sendPushForUserFollow(guard.user!.id, guard.user!.handle, other.targetId, other.targetHandle, undefined,
        undefined, service)
        .catch(error => logError('API follow activity push failed', error))
    }
    return json({ data: { following: true } })
  })

  app.delete('/api/v1/users/:handle/follow', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const handle = (c.req.param('handle') || '').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return fail('invalid_handle', 'Handle is invalid', 400)
    const other = await service.call('api.relationshipMutation', { userId: guard.user!.id, handle, action: 'unfollow' })
    if (other.status === 'self') return fail('forbidden', 'That is your own account', 403)
    if (other.status !== 'ready') return fail('not_found', 'User not found', 404)
    return json({ data: { following: false } })
  })

  app.post('/api/v1/users/:handle/block', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const handle = (c.req.param('handle') || '').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return fail('invalid_handle', 'Handle is invalid', 400)
    const other = await service.call('api.relationshipMutation', { userId: guard.user!.id, handle, action: 'block' })
    if (other.status === 'self') return fail('forbidden', 'That is your own account', 403)
    if (other.status !== 'ready') return fail('not_found', 'User not found', 404)
    return json({ data: { blocked: true } })
  })

  app.delete('/api/v1/users/:handle/block', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const handle = (c.req.param('handle') || '').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return fail('invalid_handle', 'Handle is invalid', 400)
    const other = await service.call('api.relationshipMutation', { userId: guard.user!.id, handle, action: 'unblock' })
    if (other.status === 'self') return fail('forbidden', 'That is your own account', 403)
    if (other.status !== 'ready') return fail('not_found', 'User not found', 404)
    return json({ data: { blocked: false } })
  })

  app.post('/api/v1/posts/:id/report', async c => {
    const guard = await writer(service, requestApiUser, c)
    if (guard.error) return guard.error
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return fail('invalid_post_id', 'Post ID must be a positive integer', 400)
    const payload = await body(c)
    const reason = text(payload?.reason)
    if (!['harassment', 'spam', 'impersonation', 'other'].includes(reason)) {
      return fail('invalid_reason', 'Reason must be harassment, spam, impersonation or other', 400)
    }
    const result = await service.call('interactions.reportPost', { userId: guard.user!.id, postId: id, reason })
    if (result.status === 'not_found') return fail('not_found', 'Post not found', 404)
    if (result.status === 'own_post') return fail('forbidden', 'You cannot report your own post', 400)
    return json({ data: { reported: true } })
  })
}
