import {
  Compose,
  ConfirmDelete,
  EditPost,
  PublicThread,
  Reply,
} from '../components/pages'
import { moderateText, moderationMessage } from '../moderation'
import { createPost, enrichPosts, updatePost } from '../posts'
import type { PostRow, PostView } from '../types'
import { form, page, redirect, usersBlocked } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { renderPostOg } from '../og'
import { postRateLimitMessage } from '../post-rate-limit'
import { currentUser } from '../utils'

export function registerPostsRoutes(app: Hono) {
  app.get('/write', c => {
    const user = currentUser(c.req.raw)
    return user ? page(<Compose user={user} />) : redirect('/login?next=' + encodeURIComponent('/write'))
  })
  app.get('/compose', c => c.redirect('/write', 301))
  app.get('/post', c => c.redirect('/write', 303))

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
    if (user) {
      return page(
        <Reply user={user} post={post} showForm={c.req.query('reply') === '1'}
          showReport={c.req.query('report') === '1'} reported={c.req.query('reported') === '1'} social={social} />,
      )
    }
    return page(<PublicThread post={post} social={social} />)
  })

  app.get('/post/:id/og.png', c => {
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) && id > 0
      ? db.query(
        'SELECT p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL',
      )
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
    const post = Number.isInteger(id)
      ? db.query(
        'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
      ).get(id) as PostRow | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    return page(<EditPost user={user} post={post} />)
  })

  app.post('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query(
        'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
      ).get(id) as PostRow | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    const f = await form(c.req.raw)
    const body = f.body || ''
    if (body.trim().length < 1 || body.length > 280) {
      return page(
        <EditPost user={user} post={post} body={body} error="Posts must contain between 1 and 280 characters." />,
        400,
      )
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
      ? db.query('SELECT user_id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as { user_id: number;
        parent_id: number | null } | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    db.transaction(() => {
      db.query('UPDATE posts SET body=\'(deleted)\',deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id)
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
      return page(
        <Reply user={user} post={parent} showForm error={postRateLimitMessage(result.retryAfter)} body={body} />,
        429,
      )
    }
    return redirect('/post/' + parentId)
  })
}
