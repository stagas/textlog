import { About, Activity, activityTotal, AdminConfirm, AdminDashboard, AdminUser, Auth, Compose, ConfirmAccountDelete,
  ConfirmDelete, Connections, EditPost, Explore, Feed, ForgotPassword, HotFeed, Legal, Profile, PublicFeed,
  PublicThread, Reply, ResetPassword, TagFeed } from './components/pages'
import { moderateText, moderationMessage } from './moderation'
import { currentUser, hash, hashPassword, token, verifyPassword } from './utils'

import { Hono } from 'hono'
import { getConnInfo } from 'hono/bun'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configureDevReload } from './components/layout'
import { db } from './db'
import { sendPasswordReset } from './email'
import { renderDefaultOg, renderPostOg, renderProfileOg, renderTagOg } from './og'
import { postRateLimitMessage } from './post-rate-limit'
import { clearSessionCookie, feedPreference, feedPreferenceCookie, isSameOriginRequest, safeLocalPath, safeRefererPath,
  securityHeaders, sessionCookie, stringField } from './http'
import { createPost, enrichPosts, updatePost } from './posts'
import type { PostRow, PostView, ProfileRow } from './types'
import { AUTH_LIMITS, authRateLimitMessage, consumeAuthAttempt, rateLimitKey } from './auth-rate-limit'
import { anonymizeUser, isAdmin, isAdminEmail, recordAdminAction, resolvePostReports, softDeletePost } from './admin'
import type { AdminActionView, AdminReportView, DashboardStats } from './types'

const devReloadEnabled = Bun.env.DEV_RELOAD === 'true'
const bootId = crypto.randomUUID()
configureDevReload(devReloadEnabled ? bootId : undefined)

function page(node: React.ReactNode, status = 200) {
  return new Response('<!doctype html>' + renderToStaticMarkup(node), { status,
    headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-cache' } })
}
function redirect(path: string, cookie?: string) {
  const h = new Headers({ location: path })
  if (cookie) h.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers: h })
}
function rememberFeed(response: Response, feed: 'following' | 'hot' | 'latest') {
  response.headers.append('set-cookie', feedPreferenceCookie(feed))
  return response
}
function safeNext(value?: string) {
  return safeLocalPath(value)
}
function currentPage(value?: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
function paginationRedirect(requestedPage: number, total: number, path: string) {
  const lastPage = Math.max(1, Math.ceil(total / 20))
  if (requestedPage <= lastPage) return null
  if (lastPage === 1) return redirect(path)
  return redirect(`${path}${path.includes('?') ? '&' : '?'}page=${lastPage}`)
}
function visiblePostCount(userId = -1) {
  return (db.query(`SELECT count(*) count FROM posts p WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
      OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`).get(userId, userId, userId) as { count: number }).count
}
function usersBlocked(firstId: number, secondId: number) {
  return !!db.query(`SELECT 1 FROM blocks WHERE
    (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(firstId, secondId, secondId, firstId)
}
function clientAddress(c: any) {
  if (Bun.env.TRUST_PROXY === 'true') {
    const forwarded = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return getConnInfo(c).remote.address || 'unknown'
}
function authLimit(c: any, scope: string, identity: string, policy: { attempts: number; windowSeconds: number }) {
  return consumeAuthAttempt(db, scope, rateLimitKey(identity), policy.attempts, policy.windowSeconds)
}
function retryPage(response: Response, retryAfter: number) {
  response.headers.set('retry-after', String(retryAfter))
  return response
}
function adminUser(req: Request) {
  const user = currentUser(req)
  return user && isAdmin(user) ? user : null
}
async function form(req: Request) {
  const data = await req.formData()
  return new Proxy({} as Record<string, string>, {
    get: (_, property) => typeof property === 'string' ? stringField(data, property) : undefined,
  })
}
const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  for (const [name, value] of Object.entries(securityHeaders(devReloadEnabled))) c.header(name, value)
})

app.use('*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || !c.res.headers.get('content-type')?.includes('text/html')) return
  const url = new URL(c.req.url)
  const privatePath = /^\/(?:login|signup|forgot-password|reset-password|compose|activity|admin|account\/delete)(?:\/|$)/
    .test(url.pathname) || /^\/post\/\d+\/(?:edit|delete)$/.test(url.pathname)
  const transientParameters = ['reply', 'report', 'reported', 'edit', 'welcome', 'reset', 'token']
  const transient = transientParameters.some(name => url.searchParams.has(name))
  if (privatePath || transient || c.res.status >= 400) c.header('X-Robots-Tag', 'noindex, nofollow')

  if (!privatePath && c.res.status < 400) {
    for (const name of transientParameters) url.searchParams.delete(name)
    if (url.searchParams.get('page') === '1') url.searchParams.delete('page')
    const configuredOrigin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : url.origin
    const canonical = configuredOrigin + url.pathname + url.search
    c.header('Link', `<${canonical}>; rel="canonical"`)
  }
})

app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !isSameOriginRequest(c.req.raw)) return c.text('Forbidden', 403)
  await next()
})

app.get('/health', c => {
  try {
    const result = db.query('SELECT 1 AS ok').get() as { ok: number } | null
    if (result?.ok !== 1) throw new Error('Database health check failed')
    return c.json({ status: 'ok' }, 200, { 'cache-control': 'no-store' })
  }
  catch (error) {
    console.error('Health check failed', error)
    return c.json({ status: 'unavailable' }, 503, { 'cache-control': 'no-store' })
  }
})

if (devReloadEnabled) {
  app.get('/__dev/restart', c =>
    c.json({ bootId }, 200, {
      'cache-control': 'no-store, no-cache, must-revalidate',
    }))
}

app.get('/styles.css', c => {
  return new Response(Bun.file(new URL('./styles.css', import.meta.url)), {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' },
  })
})

app.get('/root.svg', c => {
  return new Response(Bun.file(new URL('./root.svg', import.meta.url)), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' },
  })
})

app.get('/og.png', c => {
  const image = renderDefaultOg()
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
})

app.get('/', c => {
  const user = currentUser(c.req.raw)
  const preferredFeed = feedPreference(c.req.raw)
  const feedPage = currentPage(c.req.query('page'))
  if (preferredFeed === 'latest') {
    const outOfRange = paginationRedirect(feedPage, visiblePostCount(user?.id), '/')
    if (outOfRange) return outOfRange
    return page(<PublicFeed user={user} page={feedPage} path="/latest" />)
  }
  if (preferredFeed === 'hot' || !user) {
    const outOfRange = paginationRedirect(feedPage, visiblePostCount(user?.id), '/')
    if (outOfRange) return outOfRange
    return page(<HotFeed user={user} page={feedPage} />)
  }
  const total = (db.query(`SELECT count(*) count FROM posts p WHERE p.deleted_at IS NULL AND
      (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR
        p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
        OR (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    .get(user.id, user.id, user.id, user.id, user.id) as { count: number }).count
  const outOfRange = paginationRedirect(feedPage, total, '/')
  if (outOfRange) return outOfRange
  return page(<Feed user={user} page={feedPage} />)
})

app.get('/for-you', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login?next=' + encodeURIComponent('/for-you'))
  const feedPage = currentPage(c.req.query('page'))
  const total = (db.query(`SELECT count(*) count FROM posts p WHERE p.deleted_at IS NULL AND
      (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR
        p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
        OR (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    .get(user.id, user.id, user.id, user.id, user.id) as { count: number }).count
  const outOfRange = paginationRedirect(feedPage, total, '/for-you')
  if (outOfRange) return rememberFeed(outOfRange, 'following')
  return rememberFeed(page(<Feed user={user} page={feedPage} />), 'following')
})

app.get('/latest', c => {
  const user = currentUser(c.req.raw)
  const feedPage = currentPage(c.req.query('page'))
  const outOfRange = paginationRedirect(feedPage, visiblePostCount(user?.id), '/latest')
  if (outOfRange) return rememberFeed(outOfRange, 'latest')
  return rememberFeed(page(<PublicFeed user={user} page={feedPage} path="/latest" />), 'latest')
})

app.get('/hot', c => {
  const user = currentUser(c.req.raw)
  const feedPage = currentPage(c.req.query('page'))
  const outOfRange = paginationRedirect(feedPage, visiblePostCount(user?.id), '/hot')
  if (outOfRange) return rememberFeed(outOfRange, 'hot')
  return rememberFeed(page(<HotFeed user={user} page={feedPage} title="hot" />), 'hot')
})

app.get('/activity', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login?next=' + encodeURIComponent('/activity'))
  const activityPage = currentPage(c.req.query('page'))
  const outOfRange = paginationRedirect(activityPage, activityTotal(user.id), '/activity')
  if (outOfRange) return outOfRange
  return page(<Activity user={user} page={activityPage} />)
})

app.get('/about', c => page(<About user={currentUser(c.req.raw)} />))
app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))

app.get('/login',
  c =>
    page(
      <Auth mode="login" next={safeNext(c.req.query('next'))}
        success={c.req.query('reset') === '1' ? 'Your password has been reset. You can log in now.' : undefined} />,
    ))
app.get('/signup', c => page(<Auth mode="signup" />))
app.get('/forgot-password', c => page(<ForgotPassword />))

app.post('/forgot-password', async c => {
  const f = await form(c.req.raw)
  const email = (f.email || '').trim().toLowerCase()
  const limited = authLimit(c, 'forgot-ip', clientAddress(c), AUTH_LIMITS.forgotIp)
    || authLimit(c, 'forgot-account', email || '(blank)', AUTH_LIMITS.forgotAccount)
  if (limited) return retryPage(page(<ForgotPassword error={authRateLimitMessage(limited.retryAfter)} />, 429), limited.retryAfter)
  const user = db.query('SELECT id,email FROM users WHERE email=?').get(email) as { id: number; email: string } | null
  if (user) {
    const resetToken = token()
    db.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(user.id, Date.now())
    db.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
      .run(hash(resetToken), user.id, Date.now() + 3600000)
    const appUrl = Bun.env.APP_URL?.replace(/\/$/, '')
    if (appUrl) {
      try {
        await sendPasswordReset(user.email, `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`)
      }
      catch (error) {
        console.error('Could not send password reset email', error)
        db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(resetToken))
      }
    }
    else {
      console.error('Could not send password reset email: APP_URL is not configured')
      db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(resetToken))
    }
  }
  return page(<ForgotPassword sent />)
})

app.get('/reset-password', c => {
  const resetToken = c.req.query('token') || ''
  const reset = resetToken && db.query('SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?')
    .get(hash(resetToken), Date.now())
  return page(<ResetPassword resetToken={resetToken} invalid={!reset} />)
})

app.post('/reset-password', async c => {
  const f = await form(c.req.raw)
  const resetToken = f.token || ''
  const limited = authLimit(c, 'reset-ip', clientAddress(c), AUTH_LIMITS.resetIp)
    || authLimit(c, 'reset-token', resetToken || '(blank)', AUTH_LIMITS.resetToken)
  if (limited) return retryPage(page(
    <ResetPassword resetToken={resetToken} error={authRateLimitMessage(limited.retryAfter)} invalid={!resetToken} />,
    429,
  ), limited.retryAfter)
  const reset = resetToken && db.query('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?')
    .get(hash(resetToken), Date.now()) as { user_id: number } | null
  if (!reset) return page(<ResetPassword invalid />, 400)
  if ((f.password || '').length < 8 || f.password !== f.confirmPassword) {
    return page(
      <ResetPassword resetToken={resetToken} error="Passwords must match and contain at least 8 characters." />,
      400,
    )
  }
  const passwordHash = await hashPassword(f.password)
  db.transaction(() => {
    db.query('UPDATE users SET password=? WHERE id=?').run(passwordHash, reset.user_id)
    db.query('DELETE FROM sessions WHERE user_id=?').run(reset.user_id)
    db.query('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id)
  })()
  return redirect('/login?reset=1')
})

app.post('/signup', async c => {
  const f = await form(c.req.raw)
  const handle = (f.handle || '').toLowerCase().replace(/^@/, '')
  const email = (f.email || '').trim().toLowerCase()
  const limited = authLimit(c, 'signup-ip', clientAddress(c), AUTH_LIMITS.signup)
  if (limited) return retryPage(page(
    <Auth mode="signup" handle={handle} email={email} error={authRateLimitMessage(limited.retryAfter)} />,
    429,
  ), limited.retryAfter)
  if (!/^[a-z0-9_]{2,24}$/.test(handle) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || (f.password || '').length < 8)
  {
    return page(
      <Auth mode="signup" handle={handle} email={email}
        error="Use a valid email, a 2–24 character handle, and a password of at least 8 characters." />,
      400,
    )
  }
  const moderation = await moderateText(`handle: ${handle}`)
  if (!moderation.ok) {
    const error = moderation.reason === 'flagged'
      ? 'That handle may violate our content rules. Please change it and try again.'
      : moderationMessage(moderation.reason)
    return page(
      <Auth mode="signup" handle={handle} email={email} error={error} />,
      moderation.reason === 'flagged' ? 422 : 503,
    )
  }
  const passwordHash = await hashPassword(f.password)
  try {
    const result = db.query('INSERT INTO users(handle,email,password) VALUES(?,?,?) RETURNING id')
      .get(handle, email, passwordHash) as { id: number }
    const session = token()
    db.query('INSERT INTO sessions VALUES(?,?,?)').run(session, result.id, Date.now() + 2592000000)
    return redirect('/explore?welcome=1', sessionCookie(session))
  }
  catch {
    return page(<Auth mode="signup" handle={handle} email={email} error="That handle or email is unavailable." />, 400)
  }
})

app.post('/login', async c => {
  const f = await form(c.req.raw)
  const login = (f.handle || '').trim().toLowerCase().replace(/^@/, '')
  const limited = authLimit(c, 'login-ip', clientAddress(c), AUTH_LIMITS.login)
  if (limited) return retryPage(page(
    <Auth mode="login" handle={login} next={safeNext(f.next)} error={authRateLimitMessage(limited.retryAfter)} />,
    429,
  ), limited.retryAfter)
  const found = db.query('SELECT id,password FROM users WHERE (handle=? OR email=?) AND deleted_at IS NULL AND suspended_at IS NULL')
    .get(login, login) as { id: number; password: string } | null
  if (!found || !await verifyPassword(f.password || '', found.password)) {
    return page(<Auth mode="login" handle={login} next={safeNext(f.next)}
      error="Invalid email, handle, or password." />, 401)
  }
  if (!found.password.startsWith('$argon2id$')) {
    db.query('UPDATE users SET password=? WHERE id=?').run(await hashPassword(f.password), found.id)
  }
  const session = token()
  db.query('INSERT INTO sessions VALUES(?,?,?)').run(session, found.id, Date.now() + 2592000000)
  return redirect(safeNext(f.next), sessionCookie(session))
})

app.post('/logout', c => {
  const session = c.req.header('cookie')?.match(/root=([^;]+)/)?.[1]
  if (session) db.query('DELETE FROM sessions WHERE token=?').run(session)
  return redirect('/', clearSessionCookie())
})

app.get('/account/delete', c => {
  const user = currentUser(c.req.raw)
  return user ? page(<ConfirmAccountDelete user={user} />) : redirect('/login')
})

app.post('/account/delete', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  if (isAdmin(user)) return c.text('Admin accounts cannot delete themselves', 403)
  const f = await form(c.req.raw)
  const account = db.query('SELECT password FROM users WHERE id=? AND deleted_at IS NULL')
    .get(user.id) as { password: string } | null
  if (!account || !await verifyPassword(f.password || '', account.password)) {
    return page(<ConfirmAccountDelete user={user} error="Your password is incorrect." />, 401)
  }
  db.transaction(() => anonymizeUser(db, user.id))()
  return redirect('/', clearSessionCookie())
})

app.get('/compose', c => {
  const user = currentUser(c.req.raw)
  return user ? page(<Compose user={user} />) : redirect('/login?next=' + encodeURIComponent('/compose'))
})
app.get('/post', c => c.redirect('/compose', 303))

app.get('/post/:id', c => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return c.text('Not found', 404)
  const foundPost = db.query(
    'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?',
  ).get(id) as PostView | null
  if (!foundPost) return c.text('Not found', 404)
  const user = currentUser(c.req.raw)
  if (user && usersBlocked(user.id, foundPost.user_id)) return c.text('Not found', 404)
  const post = enrichPosts(db, [foundPost], user?.id ?? -1)[0]
  const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
  const origin = configuredOrigin || new URL(c.req.url).origin
  const postUrl = `${origin}/post/${post.id}`
  const social = {
    description: post.body.replace(/\s+/g, ' ').trim(),
    image: `${postUrl}/og.png`,
    url: postUrl,
  }
  if (user) return page(<Reply user={user} post={post} showForm={c.req.query('reply') === '1'}
    showReport={c.req.query('report') === '1'} reported={c.req.query('reported') === '1'} social={social} />)
  return page(<PublicThread post={post} social={social} />)
})

app.get('/post/:id/og.png', c => {
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id) && id > 0
    ? db.query('SELECT p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL')
      .get(id) as { body: string; handle: string } | null
    : null
  if (!post) return c.text('Not found', 404)
  const image = renderPostOg(post.body, post.handle)
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
})

app.post('/post', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const f = await form(c.req.raw)
  const body = f.body || ''
  if (body.trim().length < 1 || body.length > 280) return page(<Compose user={user} />, 400)
  const moderation = await moderateText(body)
  if (!moderation.ok) {
    return page(<Compose user={user} body={body} error={moderationMessage(moderation.reason)} />,
      moderation.reason === 'flagged' ? 422 : 503)
  }
  const result = createPost(db, user.id, body)
  if ('retryAfter' in result) {
    return page(<Compose user={user} body={body} error={postRateLimitMessage(result.retryAfter)} />, 429)
  }
  return redirect('/')
})

app.get('/post/:id/edit', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id) ? db.query(
    'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
  ).get(id) as PostRow | null : null
  if (!post) return c.text('Not found', 404)
  if (post.user_id !== user.id) return c.text('Forbidden', 403)
  return page(<EditPost user={user} post={post} />)
})

app.post('/post/:id/edit', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id) ? db.query(
    'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
  ).get(id) as PostRow | null : null
  if (!post) return c.text('Not found', 404)
  if (post.user_id !== user.id) return c.text('Forbidden', 403)
  const f = await form(c.req.raw)
  const body = f.body || ''
  if (body.trim().length < 1 || body.length > 280) {
    return page(<EditPost user={user} post={post} body={body}
      error="Posts must contain between 1 and 280 characters." />, 400)
  }
  const moderation = await moderateText(body)
  if (!moderation.ok) {
    return page(<EditPost user={user} post={post} body={body} error={moderationMessage(moderation.reason)} />,
      moderation.reason === 'flagged' ? 422 : 503)
  }
  updatePost(db, id, body)
  return redirect('/post/' + id)
})

app.get('/post/:id/delete', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id)
    ? db.query('SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL')
      .get(id) as PostRow | null
    : null
  if (!post) return c.text('Not found', 404)
  if (post.user_id !== user.id) return c.text('Forbidden', 403)
  return page(<ConfirmDelete user={user} post={post} />)
})

app.post('/post/:id/delete', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id)
    ? db.query('SELECT user_id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as { user_id: number; parent_id: number | null } | null
    : null
  if (!post) return c.text('Not found', 404)
  if (post.user_id !== user.id) return c.text('Forbidden', 403)
  db.transaction(() => {
    db.query("UPDATE posts SET body='(deleted)',deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
    db.query('DELETE FROM post_hashtags WHERE post_id=?').run(id)
    db.query('DELETE FROM post_mentions WHERE post_id=?').run(id)
  })()
  return redirect(post.parent_id ? '/post/' + post.parent_id : '/')
})

app.post('/post/:id/reply', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const parentId = Number(c.req.param('id'))
  const parent = Number.isInteger(parentId)
    ? db.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?').get(
      parentId,
    ) as PostView | null
    : null
  if (!parent) return c.text('Not found', 404)
  if (usersBlocked(user.id, parent.user_id)) return c.text('Forbidden', 403)
  const f = await form(c.req.raw)
  const body = f.body || ''
  if (body.trim().length < 1 || body.length > 280) {
    return page(
      <Reply user={user} post={parent} showForm error="Replies must contain between 1 and 280 characters."
        body={body} />,
      400,
    )
  }
  const moderation = await moderateText(body)
  if (!moderation.ok) {
    return page(<Reply user={user} post={parent} showForm error={moderationMessage(moderation.reason)} body={body} />,
      moderation.reason === 'flagged' ? 422 : 503)
  }
  const result = createPost(db, user.id, body, parentId)
  if ('retryAfter' in result) {
    return page(<Reply user={user} post={parent} showForm error={postRateLimitMessage(result.retryAfter)} body={body} />,
      429)
  }
  return redirect('/post/' + parentId)
})

app.post('/follow/:handle', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const handle = c.req.param('handle').toLowerCase()
  if (!/^[a-z0-9_]{2,24}$/.test(handle)) return c.text('Invalid handle', 400)
  const f = await form(c.req.raw)
  const target = db.query('SELECT id FROM users WHERE handle=? AND deleted_at IS NULL').get(handle) as { id: number } | null
  if (target && target.id !== user.id && !usersBlocked(user.id, target.id)) {
    const exists = db.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(user.id, target.id)
    exists
      ? db.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(user.id, target.id)
      : db.query('INSERT OR IGNORE INTO follows(follower_id,following_id,created_at) VALUES(?,?,CURRENT_TIMESTAMP)')
        .run(user.id, target.id)
  }
  const referer = c.req.header('referer')
  const returnPath = safeRefererPath(referer, c.req.url)
  if (referer && URL.canParse(referer)) {
    const url = new URL(referer)
    if (url.pathname === '/explore' && /^\d+(,\d+){0,5}$/.test(f.explorePeople || '')) {
      return redirect(url.pathname + url.search,
        `explore_people=${f.explorePeople}; HttpOnly; Path=/explore; SameSite=Lax`)
    }
  }
  return redirect(returnPath)
})

app.post('/block/:handle', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const handle = c.req.param('handle').toLowerCase()
  const target = db.query('SELECT id FROM users WHERE handle=? AND deleted_at IS NULL').get(handle) as { id: number } | null
  if (!target || target.id === user.id) return c.text('Not found', 404)
  const exists = db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(user.id, target.id)
  db.transaction(() => {
    if (exists) db.query('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(user.id, target.id)
    else {
      db.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(?,?)').run(user.id, target.id)
      db.query('DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)')
        .run(user.id, target.id, target.id, user.id)
    }
  })()
  return redirect('/u/' + handle)
})

app.post('/post/:id/report', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const postId = Number(c.req.param('id'))
  const post = Number.isInteger(postId) ? db.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
    .get(postId) as { user_id: number } | null : null
  if (!post) return c.text('Not found', 404)
  if (post.user_id === user.id) return c.text('You cannot report your own post', 400)
  if (usersBlocked(user.id, post.user_id)) return c.text('Not found', 404)
  const f = await form(c.req.raw)
  if (!['harassment', 'spam', 'impersonation', 'other'].includes(f.reason)) return c.text('Invalid reason', 400)
  db.query(`INSERT INTO reports(reporter_id,post_id,reason) VALUES(?,?,?)
    ON CONFLICT(reporter_id,post_id) DO UPDATE SET reason=excluded.reason,created_at=CURRENT_TIMESTAMP`)
    .run(user.id, postId, f.reason)
  return redirect(`/post/${postId}?reported=1`)
})

app.post('/tag-follow/:tag', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  const tag = c.req.param('tag').toLowerCase()
  if (!/^[a-z0-9_]{1,280}$/.test(tag)) return c.text('Invalid tag', 400)
  const exists = db.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?').get(user.id, tag)
  exists
    ? db.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(user.id, tag)
    : db.query('INSERT OR IGNORE INTO hashtag_follows VALUES(?,?)').run(user.id, tag)
  return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + tag))
})

app.get('/explore', c => {
  const savedPeople = c.req.header('cookie')?.match(/(?:^|;\s*)explore_people=([\d,]+)/)?.[1]
  const peopleIds = savedPeople?.split(',').map(Number)
  const response = page(
    <Explore user={currentUser(c.req.raw)} welcome={c.req.query('welcome') === '1'} peopleIds={peopleIds} />,
  )
  if (savedPeople) {
    response.headers.append('set-cookie', 'explore_people=; Max-Age=0; Path=/explore; HttpOnly; SameSite=Lax')
  }
  return response
})

app.get('/admin', c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const statusValue = c.req.query('status') || 'open'
  if (!['open', 'resolved', 'dismissed'].includes(statusValue)) return c.text('Invalid report status', 400)
  const status = statusValue as 'open' | 'resolved' | 'dismissed'
  const reportPage = currentPage(c.req.query('page'))
  const stats = db.query(`SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL) users,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND suspended_at IS NOT NULL) suspendedUsers,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL) activePosts,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND parent_id IS NOT NULL) replies,
    (SELECT count(*) FROM reports WHERE status='open') openReports,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) users24h,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) users7d,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) posts24h,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) posts7d`) as any
  const dashboardStats = stats.get() as DashboardStats
  const total = (db.query('SELECT count(*) count FROM reports WHERE status=?').get(status) as { count: number }).count
  const outOfRange = paginationRedirect(reportPage, total, `/admin?status=${status}`)
  if (outOfRange) return outOfRange
  const reports = db.query(`SELECT r.id,r.reason,r.status,r.created_at,r.resolved_at,r.post_id,
    p.body post_body,p.deleted_at post_deleted_at,p.user_id author_id,author.handle author_handle,
    reporter.handle reporter_handle,resolver.handle resolver_handle
    FROM reports r JOIN posts p ON p.id=r.post_id JOIN users author ON author.id=p.user_id
    JOIN users reporter ON reporter.id=r.reporter_id LEFT JOIN users resolver ON resolver.id=r.resolved_by
    WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`)
    .all(status, (reportPage - 1) * 20) as AdminReportView[]
  const actions = db.query(`SELECT aa.id,aa.action,aa.note,aa.created_at,actor.handle actor_handle,
    aa.target_user_id,target.handle target_handle,aa.target_post_id
    FROM admin_actions aa JOIN users actor ON actor.id=aa.actor_id
    LEFT JOIN users target ON target.id=aa.target_user_id ORDER BY aa.created_at DESC,aa.id DESC LIMIT 20`)
    .all() as AdminActionView[]
  const suspended = db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE deleted_at IS NULL AND suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 20`).all() as ProfileRow[]
  return page(<AdminDashboard user={signedIn} stats={dashboardStats} reports={reports} actions={actions}
    status={status} page={reportPage} total={total} suspended={suspended} />)
})

app.post('/admin/reports/:id/:decision', async c => {
  const user = adminUser(c.req.raw)
  if (!currentUser(c.req.raw)) return redirect('/login?next=' + encodeURIComponent('/admin'))
  if (!user) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const decision = c.req.param('decision')
  if (!Number.isInteger(id) || !['resolve', 'dismiss'].includes(decision)) return c.text('Not found', 404)
  const report = db.query('SELECT post_id FROM reports WHERE id=? AND status=\'open\'').get(id) as
    { post_id: number } | null
  if (!report) return c.text('Report is not open', 409)
  const f = await form(c.req.raw)
  db.transaction(() => {
    db.query(`UPDATE reports SET status=?,resolved_at=CURRENT_TIMESTAMP,resolved_by=? WHERE id=? AND status='open'`)
      .run(decision === 'resolve' ? 'resolved' : 'dismissed', user.id, id)
    recordAdminAction(db, user.id, decision === 'resolve' ? 'resolve_report' : 'dismiss_report', null,
      report.post_id, f.note || '')
  })()
  return redirect('/admin')
})

app.get('/admin/posts/:id/delete', c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id) ? db.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,
    u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL`).get(id) as
    (PostRow & { handle: string }) | null : null
  if (!post) return c.text('Not found', 404)
  const returnTo = c.req.query('report') ? '/admin' : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
  return page(<AdminConfirm user={signedIn} kind="delete_post" post={post} returnTo={returnTo} />)
})

app.post('/admin/posts/:id/delete', async c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent('/admin'))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const post = Number.isInteger(id) ? db.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as
    { user_id: number } | null : null
  if (!post) return c.text('Not found', 404)
  const f = await form(c.req.raw)
  db.transaction(() => {
    softDeletePost(db, id)
    resolvePostReports(db, id, signedIn.id)
    recordAdminAction(db, signedIn.id, 'delete_post', post.user_id, id, f.note || '')
  })()
  return redirect(safeLocalPath(f.returnTo, '/admin'))
})

app.get('/admin/users/:id', c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const target = Number.isInteger(id) ? db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE id=? AND deleted_at IS NULL`).get(id) as ProfileRow | null : null
  if (!target) return c.text('Not found', 404)
  return page(<AdminUser user={signedIn} target={target} />)
})

app.get('/admin/users/:id/:action', c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const action = c.req.param('action')
  if (!['suspend', 'restore', 'delete'].includes(action)) return c.text('Not found', 404)
  const target = Number.isInteger(id) ? db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE id=? AND deleted_at IS NULL`).get(id) as ProfileRow | null : null
  if (!target) return c.text('Not found', 404)
  if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
  if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
  if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
  return page(<AdminConfirm user={signedIn} target={target}
    kind={action === 'suspend' ? 'suspend_user' : action === 'restore' ? 'restore_user' : 'delete_user'}
    returnTo={`/admin/users/${id}`} />)
})

app.post('/admin/users/:id/:action', async c => {
  const signedIn = currentUser(c.req.raw)
  if (!signedIn) return redirect('/login?next=' + encodeURIComponent('/admin'))
  if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const action = c.req.param('action')
  if (!Number.isInteger(id) || !['suspend', 'restore', 'delete'].includes(action)) return c.text('Not found', 404)
  const target = db.query('SELECT id,email,suspended_at FROM users WHERE id=? AND deleted_at IS NULL').get(id) as
    { id: number; email: string; suspended_at: string | null } | null
  if (!target) return c.text('Not found', 404)
  if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
  if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
  if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
  const f = await form(c.req.raw)
  db.transaction(() => {
    if (action === 'suspend') {
      db.query('UPDATE users SET suspended_at=CURRENT_TIMESTAMP WHERE id=?').run(id)
      db.query('DELETE FROM sessions WHERE user_id=?').run(id)
      recordAdminAction(db, signedIn.id, 'suspend_user', id, null, f.note || '')
    }
    else if (action === 'restore') {
      db.query('UPDATE users SET suspended_at=NULL WHERE id=?').run(id)
      recordAdminAction(db, signedIn.id, 'restore_user', id, null, f.note || '')
    }
    else {
      recordAdminAction(db, signedIn.id, 'delete_user', id, null, f.note || '')
      anonymizeUser(db, id, signedIn.id)
    }
  })()
  return redirect(action === 'delete' ? '/admin' : `/admin/users/${id}`)
})

app.get('/u/:handle/og.png', c => {
  const profile = db.query(
    `SELECT u.handle,u.bio,
      (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) notes,
      (SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following,
      (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) followingTags,
      (SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers
      FROM users u WHERE u.handle=? AND u.deleted_at IS NULL`,
  ).get(c.req.param('handle')) as {
    handle: string; bio: string; notes: number; following: number; followingTags: number; followers: number
  } | null
  if (!profile) return c.text('Not found', 404)
  const image = renderProfileOg(profile.handle, profile.bio, profile)
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
})

app.get('/u/:handle/:kind', c => {
  const kind = c.req.param('kind')
  if (kind !== 'following' && kind !== 'followers') return c.text('Not found', 404)
  const pageQuery = c.req.query('page') ? `&page=${encodeURIComponent(c.req.query('page')!)}` : ''
  return redirect(`/u/${c.req.param('handle')}?tab=${kind}${pageQuery}`)
})

app.get('/u/:handle', c => {
  const user = currentUser(c.req.raw)
  const profilePage = currentPage(c.req.query('page'))
  const profile = db.query(
    'SELECT id,handle,email,bio,suspended_at,deleted_at FROM users WHERE handle=? AND deleted_at IS NULL',
  ).get(c.req.param('handle')) as ProfileRow | null
  if (!profile) return c.text('Not found', 404)
  const tab = c.req.query('tab')
  if (tab && tab !== 'following' && tab !== 'followers') return c.text('Not found', 404)
  const posts = enrichPosts(db, db.query(
    'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 20 OFFSET ?',
  ).all(profile.id, (profilePage - 1) * 20) as PostView[], user?.id ?? -1)
  const total =
    (db.query('SELECT count(*) AS count FROM posts WHERE user_id=? AND deleted_at IS NULL').get(profile.id) as { count: number }).count
  const following = !!user
    && !!db.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(user.id, profile.id)
  const blocked = !!user
    && !!db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(user.id, profile.id)
  const blockedByProfile = !!user
    && !!db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(profile.id, user.id)
  const viewerId = user?.id ?? -1
  const counts = db.query(
    `SELECT
      (SELECT count(*) FROM follows f WHERE following_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
          OR (b.blocker_id=f.follower_id AND b.blocked_id=?)))) followerCount,
      (SELECT count(*) FROM follows f WHERE follower_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.following_id)
          OR (b.blocker_id=f.following_id AND b.blocked_id=?)))) followingCount,
      (SELECT count(*) FROM hashtag_follows WHERE user_id=?) followingTagCount`,
  ).get(profile.id, viewerId, viewerId, viewerId, profile.id, viewerId, viewerId, viewerId, profile.id) as {
    followerCount: number; followingCount: number; followingTagCount: number
  }
  const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
  const origin = configuredOrigin || new URL(c.req.url).origin
  const profileUrl = `${origin}/u/${profile.handle}`
  const description = profile.bio.replace(/\s+/g, ' ').trim() || `@${profile.handle} on root.mx`
  const social = {
    description,
    image: `${profileUrl}/og.png`,
    url: profileUrl,
    type: 'profile' as const,
    imageAlt: `Profile for @${profile.handle}: ${description}`,
  }
  if (blocked || blockedByProfile) {
    return page(<Profile user={user} profile={profile} posts={[]} following={false} blocked={blocked}
      blockedByProfile={blockedByProfile} total={0} followerCount={0} followingCount={0}
      followingTagCount={0} social={social} />)
  }
  if (!tab) {
    const outOfRange = paginationRedirect(profilePage, total, `/u/${profile.handle}`)
    if (outOfRange) return outOfRange
  }
  if (tab === 'following' || tab === 'followers') {
    const join = tab === 'following'
      ? 'JOIN follows f ON f.following_id=u.id WHERE f.follower_id=?'
      : 'JOIN follows f ON f.follower_id=u.id WHERE f.following_id=?'
    const people = db.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing
        FROM users u ${join} AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
        ORDER BY u.handle LIMIT 20 OFFSET ?`,
    ).all(viewerId, profile.id, viewerId, viewerId, viewerId,
      (profilePage - 1) * 20) as import('./types').PersonView[]
    const countWhere = tab === 'following' ? 'follower_id=?' : 'following_id=?'
    const counterpart = tab === 'following' ? 'f.following_id' : 'f.follower_id'
    const connectionTotal = (db.query(`SELECT count(*) AS count FROM follows f WHERE ${countWhere}
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=${counterpart}) OR (b.blocker_id=${counterpart} AND b.blocked_id=?)))`)
      .get(profile.id, viewerId, viewerId, viewerId) as { count: number }).count
    const outOfRange = paginationRedirect(profilePage, connectionTotal, `/u/${profile.handle}?tab=${tab}`)
    if (outOfRange) return outOfRange
    const tags = tab === 'following'
      ? db.query(
        `SELECT hf.tag,
          (SELECT count(*) FROM post_hashtags ph JOIN posts hp ON hp.id=ph.post_id
            WHERE ph.tag=hf.tag AND hp.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
              (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=hp.user_id)
                OR (b.blocker_id=hp.user_id AND b.blocked_id=?)))) count,
          EXISTS(SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=? AND vhf.tag=hf.tag) viewerFollowing
          FROM hashtag_follows hf
          WHERE hf.user_id=?
          ORDER BY hf.tag`,
      ).all(viewerId, viewerId, viewerId, viewerId, profile.id) as
        { tag: string; count: number; viewerFollowing: boolean }[]
      : []
    return page(<Connections user={user} profile={profile} people={people} tags={tags} kind={tab}
      page={profilePage} total={connectionTotal} noteCount={total} {...counts} following={following} social={social} />)
  }
  return page(
    <Profile user={user} profile={profile} posts={blocked || blockedByProfile ? [] : posts} following={following}
      blocked={blocked}
      editing={user?.id === profile.id && c.req.query('edit') === '1'} page={profilePage}
      total={total} followerCount={counts.followerCount} followingCount={counts.followingCount}
      followingTagCount={counts.followingTagCount} social={social} />,
  )
})

app.post('/u/:handle/profile', async c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login')
  if (user.handle !== c.req.param('handle')) return c.text('Forbidden', 403)
  const f = await form(c.req.raw)
  // Preserve whitespace because spaces and line breaks can be meaningful in ASCII art.
  // Treat an entirely blank submission as an empty bio, though.
  const submittedBio = f.bio || ''
  const bio = submittedBio.trim() ? submittedBio : ''
  const handle = (f.handle || '').toLowerCase().replace(/^@/, '')
  const email = (f.email || '').trim().toLowerCase()
  const posts = enrichPosts(db, db.query(
    'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC',
  ).all(user.id) as PostView[], user.id)
  if (!/^[a-z0-9_]{2,24}$/.test(handle) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || email.length > 254 || bio.length > 160)
  {
    return page(
      <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle}
        editEmail={email} editing
        error="Use a valid email, a 2–24 character username, and a bio up to 160 characters." />,
      400,
    )
  }
  if (isAdmin(user) && email !== user.email.toLowerCase()) {
    return page(<Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle}
      editEmail={email} editing error="Hardcoded admin accounts cannot change their protected email." />, 400)
  }
  if (handle || bio) {
    const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
    if (!moderation.ok) {
      return page(
        <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle}
          editEmail={email} editing error={moderationMessage(moderation.reason)} />,
        moderation.reason === 'flagged' ? 422 : 503,
      )
    }
  }
  try {
    db.query('UPDATE users SET handle=?,email=?,bio=? WHERE id=?').run(handle, email, bio, user.id)
  }
  catch {
    return page(
      <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle}
        editEmail={email} editing error="That username or email is unavailable." />,
      400,
    )
  }
  return redirect('/u/' + handle)
})

app.get('/tag/:tag/og.png', c => {
  const tag = c.req.param('tag').toLowerCase()
  const total = (db.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
    WHERE ph.tag=? AND p.deleted_at IS NULL`)
    .get(tag) as { count: number }).count
  const image = renderTagOg(tag, total)
  const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
})

app.get('/tag/:tag', c => {
  const user = currentUser(c.req.raw)
  const tagPage = currentPage(c.req.query('page'))
  const tag = c.req.param('tag').toLowerCase()
  const following = !!user && !!db.query(
    'SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?',
  ).get(user.id, tag)
  const viewerId = user?.id ?? -1
  const posts = enrichPosts(db, db.query(
    `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id JOIN post_hashtags ph ON ph.post_id=p.id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      ORDER BY p.created_at DESC LIMIT 20 OFFSET ?`,
  ).all(tag, viewerId, viewerId, viewerId, (tagPage - 1) * 20) as PostView[], viewerId)
  const total =
    (db.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
      .get(tag, viewerId, viewerId, viewerId) as { count: number }).count
  const outOfRange = paginationRedirect(tagPage, total, `/tag/${tag}`)
  if (outOfRange) return outOfRange
  const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
  const origin = configuredOrigin || new URL(c.req.url).origin
  const tagUrl = `${origin}/tag/${encodeURIComponent(tag)}`
  const description = `${total} ${total === 1 ? 'note' : 'notes'} tagged #${tag} on root.mx`
  const social = {
    description,
    image: `${tagUrl}/og.png`,
    url: tagUrl,
    type: 'website' as const,
    imageAlt: `#${tag}: ${description}`,
  }
  return page(
    <TagFeed user={user} tag={tag} following={following} posts={posts} page={tagPage}
      total={total} social={social} />,
  )
})

app.notFound(c => c.text('Not found', 404))
app.onError((error, c) => {
  console.error(error)
  return c.text('Something went wrong', 500)
})

export default { port: 3000, host: '0.0.0.0', fetch: app.fetch }
console.log('root listening on http://localhost:3000')
