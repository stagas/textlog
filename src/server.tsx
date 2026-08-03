import { About, Activity, Auth, Compose, ConfirmAccountDelete, ConfirmDelete, Connections, EditPost, Explore, Feed, ForgotPassword, HotFeed, Legal, Profile, PublicFeed, PublicThread, Reply, ResetPassword,
  TagFeed } from './components/pages'
import { moderateText, moderationMessage } from './moderation'
import { currentUser, hash, hashPassword, token, verifyPassword } from './utils'

import { Hono } from 'hono'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configureDevReload } from './components/layout'
import { db } from './db'
import { sendPasswordReset } from './email'
import { renderDefaultOg, renderPostOg, renderProfileOg, renderTagOg } from './og'
import { postRateLimitMessage } from './post-rate-limit'
import { clearSessionCookie, isSameOriginRequest, safeLocalPath, safeRefererPath, sessionCookie, stringField } from './http'
import { createPost, enrichPosts, updatePost } from './posts'
import type { PostRow, PostView, ProfileRow } from './types'

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
function safeNext(value?: string) {
  return safeLocalPath(value)
}
function currentPage(value?: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
function usersBlocked(firstId: number, secondId: number) {
  return !!db.query(`SELECT 1 FROM blocks WHERE
    (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(firstId, secondId, secondId, firstId)
}
async function form(req: Request) {
  const data = await req.formData()
  return new Proxy({} as Record<string, string>, {
    get: (_, property) => typeof property === 'string' ? stringField(data, property) : undefined,
  })
}
const app = new Hono()

app.use('*', async (c, next) => {
  if (c.req.method === 'POST' && !isSameOriginRequest(c.req.raw)) return c.text('Forbidden', 403)
  await next()
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
  const feedPage = currentPage(c.req.query('page'))
  return user ? page(<Feed user={user} page={feedPage} />) : page(<HotFeed user={null} page={feedPage} />)
})

app.get('/latest', c => {
  const user = currentUser(c.req.raw)
  return page(<PublicFeed user={user} page={currentPage(c.req.query('page'))} path="/latest" />)
})

app.get('/hot', c => {
  return page(<HotFeed user={currentUser(c.req.raw)} page={currentPage(c.req.query('page'))} title="hot" />)
})

app.get('/activity', c => {
  const user = currentUser(c.req.raw)
  if (!user) return redirect('/login?next=' + encodeURIComponent('/activity'))
  return page(<Activity user={user} page={currentPage(c.req.query('page'))} />)
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
  const found = db.query('SELECT id,password FROM users WHERE (handle=? OR email=?) AND deleted_at IS NULL')
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
  const f = await form(c.req.raw)
  const account = db.query('SELECT password FROM users WHERE id=? AND deleted_at IS NULL')
    .get(user.id) as { password: string } | null
  if (!account || !await verifyPassword(f.password || '', account.password)) {
    return page(<ConfirmAccountDelete user={user} error="Your password is incorrect." />, 401)
  }
  db.transaction(() => {
    db.query("UPDATE posts SET body='(deleted)',deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP) WHERE user_id=?")
      .run(user.id)
    db.query('DELETE FROM post_hashtags WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)')
      .run(user.id)
    db.query('DELETE FROM post_mentions WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)')
      .run(user.id)
    db.query('DELETE FROM post_mentions WHERE user_id=?').run(user.id)
    db.query('DELETE FROM follows WHERE follower_id=? OR following_id=?').run(user.id, user.id)
    db.query('DELETE FROM hashtag_follows WHERE user_id=?').run(user.id)
    db.query('DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?').run(user.id, user.id)
    db.query('DELETE FROM reports WHERE reporter_id=?').run(user.id)
    db.query('DELETE FROM password_resets WHERE user_id=?').run(user.id)
    db.query('DELETE FROM sessions WHERE user_id=?').run(user.id)
    db.query(`UPDATE users SET handle=?,email=?,bio='',password='!',deleted_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(`deleted-${user.id}`, `deleted-${user.id}@root.mx`, user.id)
  })()
  return redirect('/', clearSessionCookie())
})

app.get('/compose', c => {
  const user = currentUser(c.req.raw)
  return user ? page(<Compose user={user} />) : redirect('/login')
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
    'SELECT id,handle,email,bio,deleted_at FROM users WHERE handle=? AND deleted_at IS NULL',
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
      total={0} followerCount={0} followingCount={0} followingTagCount={0} social={social} />)
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
