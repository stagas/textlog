import {
  Compose,
  ConfirmDelete,
  EditPost,
  PublicThread,
  Reply,
} from '../components/pages'
import { conversationTopPath, postedReplyPath } from '../components/post'
import { moderateText, moderationMessage } from '../moderation'
import { canPublishPosts } from '../posting-policy'
import { createPost, enrichPosts, updatePost } from '../posts'
import type { PostRow, PostView } from '../types'
import { form, page, redirect, rememberFeed, safeNext, usersBlocked } from './shared'

import type { Hono } from 'hono'
import { softDeletePost } from '../admin'
import type { PostingSuggestionSearch } from '../components/page-shared'
import { db } from '../db'
import { safeRefererPath } from '../http'
import { logError } from '../log'
import { deleteLinkPreviewImages, discoverLinkPreviews, replaceLinkPreviews, saveLinkPreviews } from '../link-preview'
import { renderPostOg } from '../og'
import { normalizePostBody, postBodyValidationMessage, validPostBody } from '../post-body'
import { postRateLimitMessage } from '../post-rate-limit'
import { sendPushForPost } from '../push'
import { normalizeSearchQuery, searchPeople, searchTags } from '../search'
import { currentUser } from '../utils'

function notifyPost(postId: number, userId: number, handle: string) {
  void sendPushForPost(postId, userId, handle).catch(error => logError('activity push failed', error))
}

const saveFailureMessage = 'Something went wrong while saving. Your text is still here; please try again.'

function postingSuggestionSearch(fields: Record<string, string>, viewerId: number): PostingSuggestionSearch | null {
  if (fields.action !== 'search-hashtags' && fields.action !== 'search-mentions') return null
  const hashtagQuery = normalizeSearchQuery(fields.hashtag_query)
  const mentionQuery = normalizeSearchQuery(fields.mention_query)
  // An implicit form submission (pressing Enter in a search input) can send the
  // first submit button's value, regardless of which helper input has focus.
  const kind = fields.action === 'search-hashtags' && !hashtagQuery && mentionQuery
    ? 'mentions'
    : fields.action === 'search-mentions' && !mentionQuery && hashtagQuery
    ? 'hashtags'
    : fields.action === 'search-hashtags' ? 'hashtags' : 'mentions'
  const rawQuery = kind === 'hashtags' ? hashtagQuery : mentionQuery
  const query = normalizeSearchQuery(rawQuery.replace(kind === 'hashtags' ? /^#+\s*/u : /^@+\s*/u, ''))
  const result = kind === 'hashtags'
    ? searchTags(db, query, viewerId, 1, { followedFirst: true })
    : searchPeople(db, query, viewerId, 1, { followedFirst: true, handleOnly: true })
  const rows = kind === 'hashtags'
    ? result.rows.map(row => 'tag' in row ? row.tag : '')
    : result.rows.map(row => 'handle' in row ? row.handle : '')
  return { kind, query, results: rows, truncated: result.total > 20 }
}

function editParent(post: PostRow) {
  if (!post.parent_id) return null
  return db.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,
    p.has_latex,p.has_links,p.has_code,u.handle,u.bio
    FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(post.parent_id) as PostView | null
}

export function registerPostsRoutes(app: Hono) {
  app.get('/write', c => {
    const user = currentUser(c.req.raw)
    const requestedReturnPath = c.req.query('from')
    const returnPath = requestedReturnPath
      ? safeNext(requestedReturnPath)
      : safeRefererPath(c.req.header('referer'), c.req.url)
    const resolvedReturnPath = returnPath === '/write' ? '/' : returnPath
    return user
      ? page(<Compose user={user} returnPath={resolvedReturnPath} />)
      : redirect('/enter?next=' + encodeURIComponent('/write'))
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
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const conversationRoot = foundPost.parent_id
      ? db.query(`WITH RECURSIVE ancestors(id,parent_id,depth) AS (
          SELECT id,parent_id,0 FROM posts WHERE id=?
          UNION ALL
          SELECT p.id,p.parent_id,ancestors.depth+1 FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
        ) SELECT id FROM ancestors ORDER BY depth DESC LIMIT 1`).get(id) as { id: number } | null
      : null
    const topHref = conversationRoot
      ? conversationTopPath(conversationRoot.id, id, returnPath)
      : undefined
    if (user && !user.handle_chosen_at && c.req.query('reply') === '1') {
      const next = `/post/${id}?reply=1${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
      return redirect('/choose-handle?next=' + encodeURIComponent(next))
    }
    if (user && usersBlocked(user.id, foundPost.user_id)) return c.text('Not found', 404)
    if (user && db.query(`SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=? AND bh.user_id=?`).get(id, user.id)) return c.text('Not found', 404)
    const post = enrichPosts(db, [foundPost], user?.id ?? -1)[0]
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const postUrl = `${origin}/post/${post.id}`
    const social = {
      title: `@${post.handle} wrote on textlog`,
      description: post.body.replace(/\s+/g, ' ').trim(),
      image: `${postUrl}/og.png?v=3`,
      url: postUrl,
    }
    if (user) {
      return page(
        <Reply user={user} post={post} showForm={c.req.query('reply') === '1'} returnPath={returnPath} topHref={topHref}
          showReport={c.req.query('report') === '1'} reported={c.req.query('reported') === '1'} social={social} />,
      )
    }
    return page(<PublicThread post={post} social={social} returnPath={returnPath} topHref={topHref} />)
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
        'content-length': String(image.byteLength),
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  })

  app.post('/post', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    if (!canPublishPosts(user)) return page(<Compose user={user} />, 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : '/'
    const body = normalizePostBody(f.body || '')
    const suggestionSearch = postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(<Compose user={user} body={body} returnPath={returnPath} suggestionSearch={suggestionSearch} />)
    }
    if (!validPostBody(body)) {
      return page(<Compose user={user} body={body} error={postBodyValidationMessage(body)} returnPath={returnPath} />,
        400)
    }
    if (f.action === 'preview') return page(<Compose user={user} body={body} preview returnPath={returnPath} />)
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <Compose user={user} body={body} error={moderationMessage(moderation.reason)} returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = createPost(db, user.id, body)
      if ('retryAfter' in result) {
        return page(
          <Compose user={user} body={body} error={postRateLimitMessage(result.retryAfter)} returnPath={returnPath} />,
          429,
        )
      }
      if (!result.duplicate) await saveLinkPreviews(db, result.id, await discoverLinkPreviews(body, db))
      if (!result.duplicate) notifyPost(result.id, user.id, user.handle)
      return rememberFeed(redirect(`/latest#post-${result.id}`), 'latest')
    }
    catch (error) {
      logError('POST /post', error)
      return page(<Compose user={user} body={body} error={saveFailureMessage} returnPath={returnPath} />, 500)
    }
  })

  app.get('/post/:id/edit', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query(
        'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
      ).get(id) as PostRow | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<EditPost user={user} post={post} parent={editParent(post)} returnPath={returnPath} />)
  })

  app.post('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query(
        'SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL',
      ).get(id) as PostRow | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const body = normalizePostBody(f.body || '')
    const suggestionSearch = postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <EditPost user={user} post={post} parent={editParent(post)} body={body} returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (!validPostBody(body)) {
      return page(
        <EditPost user={user} post={post} parent={editParent(post)} body={body} returnPath={returnPath}
          error={postBodyValidationMessage(body)} />,
        400,
      )
    }
    if (f.action === 'preview') {
      return page(
        <EditPost user={user} post={post} parent={editParent(post)} body={body} preview returnPath={returnPath} />,
      )
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <EditPost user={user} post={post} parent={editParent(post)} body={body} returnPath={returnPath}
            error={moderationMessage(moderation.reason)} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      updatePost(db, id, body)
      await replaceLinkPreviews(db, id, await discoverLinkPreviews(body, db))
      return redirect('/post/' + id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : ''))
    }
    catch (error) {
      logError(`POST /post/${id}/edit`, error)
      return page(
        <EditPost user={user} post={post} parent={editParent(post)} body={body} returnPath={returnPath}
          error={saveFailureMessage} />,
        500,
      )
    }
  })

  app.get('/post/:id/delete', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query('SELECT id,user_id,parent_id,body,created_at,deleted_at FROM posts WHERE id=? AND deleted_at IS NULL')
        .get(id) as PostRow | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<ConfirmDelete user={user} post={post} returnPath={returnPath} />)
  })

  app.post('/post/:id/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query('SELECT user_id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as { user_id: number;
        parent_id: number | null } | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id !== user.id) return c.text('Forbidden', 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    db.transaction(() => {
      softDeletePost(db, id)
    })()
    await deleteLinkPreviewImages(db, id)
    return redirect(post.parent_id
      ? '/post/' + post.parent_id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
      : returnPath || '/')
  })

  app.post('/post/:id/reply', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const parentId = Number(c.req.param('id'))
    const foundParent = Number.isInteger(parentId)
      ? db.query('SELECT p.*,u.handle,u.bio FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?').get(
        parentId,
      ) as PostView | null
      : null
    if (!foundParent) return c.text('Not found', 404)
    if (usersBlocked(user.id, foundParent.user_id)) return c.text('Forbidden', 403)
    const parent = enrichPosts(db, [foundParent], user.id)[0]
    if (!canPublishPosts(user)) return page(<Reply user={user} post={parent} showForm />, 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const body = normalizePostBody(f.body || '')
    const suggestionSearch = postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Reply user={user} post={parent} showForm body={body} returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (!validPostBody(body)) {
      return page(
        <Reply user={user} post={parent} showForm error={postBodyValidationMessage(body)} body={body}
          returnPath={returnPath} />,
        400,
      )
    }
    if (f.action === 'preview') {
      return page(<Reply user={user} post={parent} showForm body={body} preview returnPath={returnPath} />)
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <Reply user={user} post={parent} showForm error={moderationMessage(moderation.reason)} body={body}
            returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = createPost(db, user.id, body, parentId)
      if ('retryAfter' in result) {
        return page(
          <Reply user={user} post={parent} showForm error={postRateLimitMessage(result.retryAfter)} body={body}
            returnPath={returnPath} />,
          429,
        )
      }
      if (!result.duplicate) await saveLinkPreviews(db, result.id, await discoverLinkPreviews(body, db))
      if (!result.duplicate) notifyPost(result.id, user.id, user.handle)
      return redirect(postedReplyPath(parentId, result.id, returnPath))
    }
    catch (error) {
      logError(`POST /post/${parentId}/reply`, error)
      return page(
        <Reply user={user} post={parent} showForm error={saveFailureMessage} body={body} returnPath={returnPath} />,
        500,
      )
    }
  })
}
