import { consumeAuthAttempt, rateLimitKey } from '../auth-rate-limit'
import { feedPreferenceCookie, limitedFormData, safeLocalPath, stringField } from '../http'
import { PAGE_SIZE } from '../pagination'
import { currentUser, hash, sessionToken, token } from '../utils'

import type { Context } from 'hono'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isAdmin } from '../admin'
import { AccountSecurity } from '../components/pages'
import { db } from '../db'
import { sendEmailVerification } from '../email'
import { sessionHash } from '../sessions'

export function page(node: React.ReactNode, status = 200) {
  return new Response('<!doctype html>' + renderToStaticMarkup(node), { status,
    headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-cache' } })
}
export function redirect(path: string, cookie?: string) {
  const h = new Headers({ location: path })
  if (cookie) h.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers: h })
}
export function rememberFeed(response: Response, feed: 'following' | 'hot' | 'latest') {
  response.headers.append('set-cookie', feedPreferenceCookie(feed))
  return response
}
export function safeNext(value?: string) {
  return safeLocalPath(value)
}
export function currentPage(value?: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
export function paginationRedirect(requestedPage: number, total: number, path: string) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (requestedPage <= lastPage) return null
  if (lastPage === 1) return redirect(path)
  return redirect(`${path}${path.includes('?') ? '&' : '?'}page=${lastPage}`)
}
export function visiblePostCount(userId = -1) {
  return (db.query(`SELECT count(*) count FROM posts p WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
      OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`).get(userId, userId, userId) as { count: number }).count
}
export function usersBlocked(firstId: number, secondId: number) {
  return !!db.query(`SELECT 1 FROM blocks WHERE
    (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(firstId, secondId, secondId, firstId)
}
export function clientAddress(c: Context) {
  if (Bun.env.TRUST_PROXY === 'true') {
    const forwarded = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return c.req.header('x-root-client-ip') || 'unknown'
}
export function authLimit(c: Context, scope: string, identity: string,
  policy: { attempts: number; windowSeconds: number })
{
  return consumeAuthAttempt(db, scope, rateLimitKey(identity), policy.attempts, policy.windowSeconds)
}
export function retryPage(response: Response, retryAfter: number) {
  response.headers.set('retry-after', String(retryAfter))
  return response
}
export function adminUser(req: Request) {
  const user = currentUser(req)
  return user && isAdmin(user) ? user : null
}
export async function issueEmailToken(userId: number, email: string, kind: 'verify' | 'change') {
  const appUrl = Bun.env.APP_URL?.replace(/\/$/, '')
  if (!appUrl) throw new Error('APP_URL is not configured')
  const value = token()
  db.query('DELETE FROM email_tokens WHERE user_id=? AND kind=?').run(userId, kind)
  db.query('INSERT INTO email_tokens(token_hash,user_id,kind,email,expires_at) VALUES(?,?,?,?,?)')
    .run(hash(value), userId, kind, email, Date.now() + 3600000)
  try {
    await sendEmailVerification(email, `${appUrl}/verify-email?token=${encodeURIComponent(value)}`, kind === 'change')
  }
  catch (error) {
    db.query('DELETE FROM email_tokens WHERE token_hash=?').run(hash(value))
    throw error
  }
}
export function securityPage(req: Request, error?: string, success?: string, status = 200) {
  const user = currentUser(req)
  if (!user) return redirect('/login?next=' + encodeURIComponent('/account/security'))
  const current = sessionHash(sessionToken(req))
  const rows = db.query(`SELECT token_hash,created_at,expires_at,user_agent FROM sessions
    WHERE user_id=? AND expires_at>? ORDER BY created_at DESC`).all(user.id, Date.now()) as { token_hash: string;
    created_at: number; expires_at: number; user_agent: string }[]
  const sessions = rows.map(({ token_hash, ...row }) => ({ ...row, token: token_hash,
    current: token_hash === current })
  )
  return page(<AccountSecurity user={user} sessions={sessions} error={error} success={success} />, status)
}
export async function form(req: Request, maxBytes?: number) {
  const data = await limitedFormData(req, maxBytes)
  return new Proxy({} as Record<string, string>, {
    get: (_, property) => typeof property === 'string' ? stringField(data, property) : undefined,
  })
}
