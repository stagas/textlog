import {
  Compose,
  ConfirmDelete,
  EditPost,
  PublicThread,
  Reply,
} from '../components/pages'
import { conversationTopPath, postedReplyPath } from '../components/post'
import { databaseService } from '../database-service'
import { moderateText, moderationMessage } from '../moderation'
import { canPublishPosts } from '../posting-policy'
import { form, page, redirect, rememberFeed, safeNext } from './shared'

import type { Hono } from 'hono'
import { publishPost } from '../api-broker'
import type { PostingSuggestionSearch } from '../components/page-shared'
import { safeRefererPath } from '../http'
import { deleteImages, deleteImagesAfterCommit } from '../image-storage'
import { discoverLinkPreviews } from '../link-preview'
import { logError } from '../log'
import { markdownPlainText } from '../markdown'
import { renderPostOg } from '../og'
import { normalizePostBody, postBodyValidationMessage, validPostBody } from '../post-body'
import { postRateLimitMessage } from '../post-rate-limit'
import { sendPushForPost } from '../push'
import { normalizeSearchQuery } from '../search'
import { currentUser } from '../utils'

function notifyPost(postId: number, userId: number, handle: string) {
  void sendPushForPost(postId, userId, handle).catch(error => logError('activity push failed', error))
}

const saveFailureMessage = 'Something went wrong while saving. Your text is still here; please try again.'

async function postingSuggestionSearch(fields: Record<string, string>,
  viewerId: number): Promise<PostingSuggestionSearch | null>
{
  if (fields.action !== 'search-hashtags' && fields.action !== 'search-mentions') return null
  const hashtagQuery = normalizeSearchQuery(fields.hashtag_query)
  const mentionQuery = normalizeSearchQuery(fields.mention_query)
  // An implicit form submission (pressing Enter in a search input) can send the
  // first submit button's value, regardless of which helper input has focus.
  const kind = fields.action === 'search-hashtags' && !hashtagQuery && mentionQuery
    ? 'mentions'
    : fields.action === 'search-mentions' && !mentionQuery && hashtagQuery
    ? 'hashtags'
    : fields.action === 'search-hashtags'
    ? 'hashtags'
    : 'mentions'
  const rawQuery = kind === 'hashtags' ? hashtagQuery : mentionQuery
  const query = normalizeSearchQuery(rawQuery.replace(kind === 'hashtags' ? /^#+\s*/u : /^@+\s*/u, ''))
  const result = await databaseService().call('posts.suggestions', { kind, query, viewerId })
  return { kind, query, ...result }
}

async function persistPreviews(postId: number, mode: 'save' | 'replace', body: string) {
  const previews = await discoverLinkPreviews(body)
  const newKeys = previews.flatMap(preview => 'imageKey' in preview && preview.imageKey ? [preview.imageKey] : [])
  try {
    const result = await databaseService().call('api.persistPostPreviews', { postId, mode, previews })
    await deleteImagesAfterCommit(result.obsoleteImageKeys)
  }
  catch (error) {
    await deleteImages(newKeys)
    throw error
  }
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

  app.get('/post/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return c.text('Not found', 404)
    const user = currentUser(c.req.raw)
    const detail = await databaseService().call('posts.detail', { id, viewerId: user?.id ?? -1 })
    if (detail.status === 'not_found') return c.text('Not found', 404)
    const post = detail.post
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const topHref = detail.conversationRootId
      ? conversationTopPath(detail.conversationRootId, id, returnPath)
      : undefined
    const flat = !topHref && c.req.query('flat') === '1'
    const flatHref = !topHref && !flat
      ? `/post/${id}?flat=1${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
      : undefined
    const treeHref = !topHref && flat
      ? `/post/${id}${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
      : undefined
    if (user && !user.handle_chosen_at && c.req.query('reply') === '1') {
      const next = `/post/${id}?reply=1${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
      return redirect('/choose-handle?next=' + encodeURIComponent(next))
    }
    const replies = await databaseService().call('posts.threadReplies', {
      parentId: post.id,
      viewerId: user?.id ?? -1,
    })
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const postUrl = `${origin}/post/${post.id}`
    const social = {
      title: `@${post.handle} wrote on textlog`,
      description: markdownPlainText(post.body),
      image: `${postUrl}/og.png?v=4`,
      url: postUrl,
    }
    if (user) {
      return page(
        <Reply user={user} post={post} replies={replies} showForm={c.req.query('reply') === '1'} returnPath={returnPath}
          topHref={topHref} flatHref={flatHref} treeHref={treeHref} flat={flat} showReport={c.req.query('report') === '1'}
          reported={c.req.query('reported') === '1'}
          social={social} />,
      )
    }
    return page(
      <PublicThread post={post} replies={replies} social={social} returnPath={returnPath} topHref={topHref}
        flatHref={flatHref} treeHref={treeHref} flat={flat} />,
    )
  })

  app.get('/post/:id/og.png', async c => {
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) && id > 0 ? await databaseService().call('posts.ogData', { id }) : null
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
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
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
      const result = await databaseService().call('api.createPost', {
        userId: user.id,
        body,
        parentId: null,
        origin: new URL(c.req.url).origin,
      })
      if (result.status === 'rate_limited') {
        return page(
          <Compose user={user} body={body} error={postRateLimitMessage(result.retryAfter)} returnPath={returnPath} />,
          429,
        )
      }
      if (result.status === 'not_found') throw new Error('Post parent unavailable')
      if (!result.duplicate) publishPost(result.id)
      if (!result.duplicate) await persistPreviews(result.id, 'save', body)
      if (!result.duplicate) notifyPost(result.id, user.id, user.handle)
      return rememberFeed(redirect(`/latest#post-${result.id}`), 'latest')
    }
    catch (error) {
      logError('POST /post', error)
      return page(<Compose user={user} body={body} error={saveFailureMessage} returnPath={returnPath} />, 500)
    }
  })

  app.get('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = Number(c.req.param('id'))
    const loaded = Number.isInteger(id) ? await databaseService().call('posts.editData', { id, userId: user.id }) : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<EditPost user={user} post={loaded.post} parent={loaded.parent} returnPath={returnPath} />)
  })

  app.post('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = Number(c.req.param('id'))
    const loaded = Number.isInteger(id) ? await databaseService().call('posts.editData', { id, userId: user.id }) : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const { post, parent } = loaded
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const body = normalizePostBody(f.body || '')
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (!validPostBody(body)) {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath}
          error={postBodyValidationMessage(body)} />,
        400,
      )
    }
    if (f.action === 'preview') {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} preview returnPath={returnPath} />,
      )
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath}
            error={moderationMessage(moderation.reason)} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = await databaseService().call('api.updatePost', {
        userId: user.id,
        id,
        body,
        origin: new URL(c.req.url).origin,
      })
      if (result.status !== 'ready') {
        return c.text(result.status === 'not_found' ? 'Not found' : 'Forbidden',
          result.status === 'not_found' ? 404 : 403)
      }
      await persistPreviews(id, 'replace', body)
      return redirect('/post/' + id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : ''))
    }
    catch (error) {
      logError(`POST /post/${id}/edit`, error)
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath}
          error={saveFailureMessage} />,
        500,
      )
    }
  })

  app.get('/post/:id/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = Number(c.req.param('id'))
    const loaded = Number.isInteger(id) ? await databaseService().call('posts.editData', { id, userId: user.id }) : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<ConfirmDelete user={user} post={loaded.post} returnPath={returnPath} />)
  })

  app.post('/post/:id/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const result = await databaseService().call('api.deletePost', { userId: user.id, id })
    if (result.status !== 'ready') {
      return c.text(result.status === 'not_found' ? 'Not found' : 'Forbidden',
        result.status === 'not_found' ? 404 : 403)
    }
    await deleteImagesAfterCommit(result.imageKeys)
    return redirect(result.parentId
      ? '/post/' + result.parentId + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
      : returnPath || '/')
  })

  app.post('/post/:id/reply', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const parentId = Number(c.req.param('id'))
    const loaded = Number.isInteger(parentId)
      ? await databaseService().call('posts.replyParent', { id: parentId, userId: user.id })
      : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const parent = loaded.post
    if (!canPublishPosts(user)) return page(<Reply user={user} post={parent} showForm />, 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const body = normalizePostBody(f.body || '')
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
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
      const result = await databaseService().call('api.createPost', {
        userId: user.id,
        body,
        parentId,
        origin: new URL(c.req.url).origin,
      })
      if (result.status === 'rate_limited') {
        return page(
          <Reply user={user} post={parent} showForm error={postRateLimitMessage(result.retryAfter)} body={body}
            returnPath={returnPath} />,
          429,
        )
      }
      if (result.status === 'not_found') return c.text('Not found', 404)
      if (!result.duplicate) publishPost(result.id)
      if (!result.duplicate) await persistPreviews(result.id, 'save', body)
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
