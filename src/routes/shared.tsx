import { randomInt } from 'node:crypto'
import { feedPreferenceCookie, limitedFormData, safeLocalPath, stringField } from '../http'
import { PAGE_SIZE } from '../pagination'
import { currentUser, hash, sessionToken, token } from '../utils'

import type { Context } from 'hono'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isAdmin } from '../admin'
import { clientIpHeaderName } from '../brand'
import { AccountSecurity, ErrorPage } from '../components/pages'
import { databaseService } from '../database-service'
import { sendEmailVerification } from '../email'
import { rateLimitMessage } from '../request-rate-limit'
import { sessionHash } from '../sessions'

export function page(node: React.ReactNode, status = 200) {
  return new Response('<!doctype html>' + renderToStaticMarkup(node), { status,
    headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'private, no-store' } })
}
export function notFoundPage(req: Request) {
  return page(<ErrorPage user={currentUser(req)} status={404} />, 404)
}
export function clientErrorPage(req: Request, status = 400) {
  const clientStatus = status >= 400 && status < 500 ? status : 400
  return page(<ErrorPage user={currentUser(req)} status={clientStatus} />, clientStatus)
}
export function serverErrorPage(req: Request) {
  return page(<ErrorPage user={currentUser(req)} status={500} />, 500)
}
export function rateLimitPage(req: Request, retryAfter: number) {
  return retryPage(
    page(<ErrorPage user={currentUser(req)} status={429} message={rateLimitMessage(retryAfter)} />, 429),
    retryAfter,
  )
}
export function redirect(path: string, cookie?: string) {
  const h = new Headers({ location: path })
  if (cookie) h.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers: h })
}
export function rememberFeed(response: Response, feed: 'following' | 'activity' | 'hot' | 'latest' | 'random') {
  response.headers.append('set-cookie', feedPreferenceCookie(feed))
  return response
}
export function safeNext(value?: string) {
  return safeLocalPath(value)
}
export function instantScrollPath(path: string) {
  const hashIndex = path.indexOf('#')
  const beforeHash = hashIndex === -1 ? path : path.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex)
  return `${beforeHash}${beforeHash.includes('?') ? '&' : '?'}_scroll=instant${hash}`
}
export function currentPage(value?: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
export function paginationRedirect(requestedPage: number, total: number, path: string, pageSize = PAGE_SIZE) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (requestedPage <= lastPage) return null
  if (lastPage === 1) return redirect(path)
  return redirect(`${path}${path.includes('?') ? '&' : '?'}page=${lastPage}`)
}
export function clientAddress(c: Context) {
  if (Bun.env.TRUST_PROXY === 'true') {
    const forwarded = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return c.req.header(clientIpHeaderName()) || 'unknown'
}
export function authLimit(c: Context, scope: string, identity: string,
  policy: { attempts: number; windowSeconds: number })
{
  return databaseService().call('system.consumeAuthAttempt', {
    scope,
    identity,
    attempts: policy.attempts,
    windowSeconds: policy.windowSeconds,
    now: Date.now(),
  })
}
export function retryPage(response: Response, retryAfter: number) {
  response.headers.set('retry-after', String(retryAfter))
  return response
}
export function adminUser(req: Request) {
  const user = currentUser(req)
  return user && isAdmin(user) ? user : null
}
export async function issueEmailToken(userId: number, email: string, kind: 'change') {
  const appUrl = Bun.env.APP_URL?.replace(/\/$/, '')
  if (!appUrl) throw new Error('APP_URL is not configured')
  const value = token()
  const tokenHash = hash(value)
  await databaseService().call('account.storeEmailToken', {
    tokenHash,
    userId,
    kind,
    email,
    expiresAt: Date.now() + 3600000,
  })
  try {
    await sendEmailVerification(email, `${appUrl}/verify-email?token=${encodeURIComponent(value)}`, kind === 'change')
  }
  catch (error) {
    await databaseService().call('account.deleteEmailToken', { tokenHash })
    throw error
  }
}
export const MAGIC_LINK_LIFETIME_MS = 15 * 60 * 1000
export const INVITATION_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export async function issueMagicLink(email: string, userId: number | null, nextPath: string, origin: string,
  lifetimeMs = MAGIC_LINK_LIFETIME_MS)
{
  const value = token()
  const code = String(randomInt(100000, 1000000))
  const now = Date.now()
  const tokenHash = hash(value)
  await databaseService().call('auth.storeMagicLink', {
    tokenHash,
    codeHash: hash(code),
    email,
    userId,
    nextPath: safeLocalPath(nextPath),
    expiresAt: now + lifetimeMs,
    now,
  })
  return { url: `${origin.replace(/\/$/, '')}/enter/magic?token=${encodeURIComponent(value)}`, code, tokenHash }
}
export async function securityPage(req: Request, error?: string, success?: string, status = 200, returnPath?: string) {
  const user = currentUser(req)
  if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/security'))
  const data = await databaseService().call('account.securityData', {
    userId: user.id,
    currentSessionHash: sessionHash(sessionToken(req)),
    now: Date.now(),
  })
  return page(
    <AccountSecurity user={user} sessions={data.sessions} apiKeys={data.apiKeys} feedKeys={data.feedKeys}
      passwordEnabled={data.passwordEnabled} error={error} success={success} returnPath={returnPath} />,
    status,
  )
}
export async function form(req: Request, maxBytes?: number) {
  const data = await limitedFormData(req, maxBytes)
  return new Proxy({} as Record<string, string>, {
    get: (_, property) => typeof property === 'string' ? stringField(data, property) : undefined,
  })
}
