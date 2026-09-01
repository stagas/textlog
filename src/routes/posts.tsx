import {
  Compose,
  ConfirmDelete,
  ConfirmDraftDelete,
  Drafts,
  EditPost,
  PublicThread,
  Reply,
} from '../components/pages'
import { conversationTopPath, postedReplyPath } from '../components/post'
import { executePostCode } from '../code-execution'
import { databaseService } from '../database-service'
import { moderatedContentDescription, moderateText, moderationMessage } from '../moderation'
import { canPublishPosts } from '../posting-policy'
import { form, page, redirect, safeNext } from './shared'

import type { Hono } from 'hono'
import { isAdmin } from '../admin'
import { cachedAnonymousPostPage, materializeAnonymousPostPage } from '../anonymous-post-page-cache'
import { publishPost } from '../api-broker'
import type { PostingSuggestionSearch } from '../components/page-shared'
import { safeRefererPath } from '../http'
import { deleteImages, deleteImagesAfterCommit } from '../image-storage'
import { discoverLinkPreviews } from '../link-preview'
import { locationMapProvider, osmLocationUrl, parseLocationQuery, resolveLocation } from '../locations'
import { logError } from '../log'
import { markdownPlainText } from '../markdown'
import { renderPostOg } from '../og'
import { cachedOgResponse, cacheOgResponse } from '../og-response-cache'
import { normalizePostBody, POST_MAX, postBodyValidationMessage, validPostBody } from '../post-body'
import { autotagText } from '../openrouter'
import { postRateLimitMessage } from '../post-rate-limit'
import { pollDisplayBody } from '../polls'
import { wakePostPushWorker } from '../push'
import { normalizeSearchQuery } from '../search'
import { toggleTodo } from '../todos'
import { postTranslation } from '../translation'
import { currentUser } from '../utils'

function notifyPost() {
  wakePostPushWorker()
}

const saveFailureMessage = 'Something went wrong while saving. Your text is still here; please try again.'

function draftId(fields: Record<string, string>) {
  return /^[0-9a-f-]{32,36}$/i.test(fields.draft_id || '') ? fields.draft_id : undefined
}

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
  const query = parseLocationQuery(body)
  if (!query) {
    await databaseService().call('api.persistPostLocation', { postId, query: null, location: null })
    return
  }
  try {
    const cached = await databaseService().call('api.cachedLocation', { query })
    const location = cached === 'miss' ? null : cached || await resolveLocation(query)
    await databaseService().call('api.persistPostLocation', { postId, query, location })
  }
  catch (error) {
    logError(`location preview failed post=${postId}`, error)
  }
}

async function previewLocation(body: string) {
  const query = parseLocationQuery(body)
  if (!query) return undefined
  try {
    const cached = await databaseService().call('api.cachedLocation', { query })
    if (cached === 'miss') return undefined
    const location = cached || await resolveLocation(query)
    if (!cached) await databaseService().call('api.cacheLocation', { query, location })
    if (!location) return undefined
    const metadata = { query: location.query, latitude: location.latitude, longitude: location.longitude,
      displayName: location.displayName }
    const [title, ...description] = location.displayName.split(',').map(part => part.trim()).filter(Boolean)
    return { ...metadata, url: osmLocationUrl(metadata), preview: {
      imageUrl: location.imageUrl, imageWidth: location.imageWidth, imageHeight: location.imageHeight,
      title: title || query, description: description.join(', ') || location.displayName,
    } }
  }
  catch (error) {
    logError('location preview failed while composing', error)
    return undefined
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

  app.get('/drafts', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/drafts'))
    const drafts = await databaseService().call('drafts.list', { userId: user.id })
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<Drafts user={user} drafts={drafts} returnPath={returnPath} />)
  })

  app.get('/drafts/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = c.req.param('id')
    const draft = await databaseService().call('drafts.get', { id, userId: user.id })
    if (!draft) return c.text('Not found', 404)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const draftsPath = `/drafts${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
    if (draft.parent_id === null) {
      return page(<Compose user={user} body={draft.body} draftId={draft.public_id} returnPath={draftsPath} />)
    }
    const loaded = await databaseService().call('posts.replyParent', { id: draft.parent_id, userId: user.id })
    if (loaded.status !== 'ready') {
      return c.text(loaded.status === 'forbidden' ? 'Forbidden' : 'Not found',
        loaded.status === 'forbidden' ? 403 : 404)
    }
    return page(
      <Reply user={user} post={loaded.post} showForm body={draft.body} draftId={draft.public_id} returnPath={draftsPath} />,
    )
  })

  app.get('/drafts/:id/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = c.req.param('id')
    const draft = await databaseService().call('drafts.get', { id, userId: user.id })
    if (!draft) return c.text('Not found', 404)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<ConfirmDraftDelete user={user} draft={draft} returnPath={returnPath} />)
  })

  app.post('/drafts/:id/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = c.req.param('id')
    const fields = await form(c.req.raw)
    if (!await databaseService().call('drafts.delete', { id, userId: user.id })) {
      return c.text('Not found', 404)
    }
    const returnPath = fields.from ? safeNext(fields.from) : undefined
    return redirect(`/drafts${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`)
  })

  app.post('/drafts/:id', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = c.req.param('id')
    const existing = await databaseService().call('drafts.get', { id, userId: user.id })
    if (!existing) return c.text('Not found', 404)
    const fields = await form(c.req.raw)
    const body = normalizePostBody(fields.body || '')
    if (!validPostBody(body)) return c.text(postBodyValidationMessage(body), 400)
    const result = await databaseService().call('drafts.save', {
      id,
      userId: user.id,
      parentId: existing.parent_id,
      body,
    })
    if (result.status === 'not_found') return c.text('Not found', 404)
    return redirect(fields.from ? safeNext(fields.from) : '/drafts')
  })

  app.get('/post/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id < 1) return c.text('Not found', 404)
    const user = currentUser(c.req.raw)
    const requestUrl = new URL(c.req.url)
    const postPageCacheKey = `${user?.id ?? 'anonymous'}\0${
      locationMapProvider(c.req.header('user-agent') || '')}\0${requestUrl.pathname}${requestUrl.search}`
    const cached = user ? null : cachedAnonymousPostPage(postPageCacheKey)
    if (cached) return cached
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
    const socialDescription = post.moderation_category
      ? moderatedContentDescription(post.moderation_category)
      : markdownPlainText(pollDisplayBody(post.body))
    const social = {
      title: `@${post.handle} wrote on textlog`,
      description: socialDescription,
      image: `${postUrl}/og.png?v=8`,
      url: postUrl,
    }
    if (user) {
      return page(
        <Reply user={user} post={post} replies={replies} showForm={c.req.query('reply') === '1'} returnPath={returnPath}
          topHref={topHref} flatHref={flatHref} treeHref={treeHref} flat={flat}
          showReport={c.req.query('report') === '1'} reported={c.req.query('reported') === '1'} social={social} />,
      )
    }
    const rendered = page(
      <PublicThread post={post} replies={replies} social={social} returnPath={returnPath} topHref={topHref}
        flatHref={flatHref} treeHref={treeHref} flat={flat} />,
    )
    return materializeAnonymousPostPage(postPageCacheKey, rendered)
  })

  app.get('/post/:id/og.png', async c => {
    const id = Number(c.req.param('id'))
    const cacheKey = `post:${id}`
    const cached = cachedOgResponse(cacheKey)
    if (cached) return cached
    const post = Number.isInteger(id) && id > 0 ? await databaseService().call('posts.ogData', { id }) : null
    if (!post) return c.text('Not found', 404)
    const image = renderPostOg(post.moderation_category
      ? moderatedContentDescription(post.moderation_category)
      : post.body, post.handle)
    return cacheOgResponse(cacheKey, image, {
      'content-type': 'image/png',
      'content-length': String(image.byteLength),
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    })
  })

  app.post('/post', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    if (!canPublishPosts(user)) return page(<Compose user={user} />, 403)
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : '/'
    const body = normalizePostBody(f.body || '')
    const editingDraftId = draftId(f)
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Compose user={user} body={body} draftId={editingDraftId} returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (f.action === 'autotag') {
      const result = await autotagText(body)
      const enrichedBody = result.ok ? normalizePostBody(result.body) : body
      const valid = result.ok && validPostBody(enrichedBody)
      return page(<Compose user={user} body={valid ? enrichedBody : body} draftId={editingDraftId}
        returnPath={returnPath} error={result.ok && !valid
          ? `The message is too big to autotag within the ${POST_MAX}-character limit. Edit it down and try again.`
          : result.ok ? undefined : result.message} />, result.ok ? 200 : 503)
    }
    if (!validPostBody(body)) {
      if (f.embedded === '1') {
        const destination = new URL(returnPath, c.req.url)
        destination.searchParams.set('write_error', postBodyValidationMessage(body))
        destination.searchParams.set('write_body', body)
        return redirect(destination.pathname + destination.search)
      }
      return page(
        <Compose user={user} body={body} draftId={editingDraftId} error={postBodyValidationMessage(body)}
          returnPath={returnPath} />,
        400,
      )
    }
    if (f.action === 'preview') {
      const result = await databaseService().call('drafts.save', {
        id: editingDraftId ?? null,
        userId: user.id,
        parentId: null,
        body,
      })
      if (result.status === 'not_found') return c.text('Not found', 404)
      user.draft_count = Math.max(user.draft_count || 0, 1)
      return page(<Compose user={user} body={body} draftId={result.id} preview
        previewExecutionOutput={await executePostCode(body)} previewLocation={await previewLocation(body)}
        returnPath={returnPath} />)
    }
    if (f.action === 'draft') {
      const result = await databaseService().call('drafts.save', {
        id: editingDraftId ?? null,
        userId: user.id,
        parentId: null,
        body,
      })
      if (result.status === 'not_found') return c.text('Not found', 404)
      return redirect(`/drafts?from=${encodeURIComponent(returnPath)}`)
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <Compose user={user} body={body} error={moderationMessage(moderation)} returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = await databaseService().call('api.createPost', {
        userId: user.id,
        body,
        parentId: null,
        origin: new URL(c.req.url).origin,
        translation: await postTranslation(body),
        moderationCategory: moderation.warning?.category,
        moderationScore: moderation.warning?.score,
        executionOutput: await executePostCode(body),
      })
      if (result.status === 'locked') return c.text('This thread is locked', 409)
      if (result.status === 'rate_limited') {
        return page(
          <Compose user={user} body={body} error={postRateLimitMessage(result.retryAfter)} returnPath={returnPath} />,
          429,
        )
      }
      if (result.status === 'not_found') throw new Error('Post parent unavailable')
      if (!result.duplicate) publishPost(result.id)
      if (!result.duplicate) await persistPreviews(result.id, 'save', body)
      if (!result.duplicate) notifyPost()
      if (editingDraftId) await databaseService().call('drafts.delete', { id: editingDraftId, userId: user.id })
      return redirect(returnPath)
    }
    catch (error) {
      logError('POST /post', error)
      return page(
        <Compose user={user} body={body} draftId={editingDraftId} error={saveFailureMessage} returnPath={returnPath} />,
        500,
      )
    }
  })

  app.get('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    const id = Number(c.req.param('id'))
    const loaded = Number.isInteger(id)
      ? await databaseService().call('posts.editData', {
        id,
        userId: user.id,
        moderator: isAdmin(user),
      })
      : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(
      <EditPost user={user} post={loaded.post} parent={loaded.parent} returnPath={returnPath}
        moderator={user.id !== loaded.post.user_id} />,
    )
  })

  app.post('/post/:id/poll', async c => {
    const user = currentUser(c.req.raw)
    const postId = Number(c.req.param('id'))
    if (!Number.isInteger(postId) || postId < 1) return c.text('Not found', 404)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(`/post/${postId}#post-${postId}`))
    const f = await form(c.req.raw)
    const optionId = Number(f.option)
    if (!Number.isInteger(optionId) || optionId < 1) return c.text('Invalid poll option', 400)
    const result = await databaseService().call('posts.votePoll', { postId, optionId, userId: user.id })
    if (result === 'not_found') return c.text('Not found', 404)
    const requested = f.from ? safeNext(f.from) : `/post/${postId}`
    const target = new URL(requested, 'http://textlog.local')
    return redirect(`${target.pathname}${target.search}#post-${postId}`)
  })

  app.post('/post/:id/todo', async c => {
    const user = currentUser(c.req.raw)
    const postId = Number(c.req.param('id'))
    if (!Number.isInteger(postId) || postId < 1) return c.text('Not found', 404)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(`/post/${postId}#post-${postId}`))
    const loaded = await databaseService().call('posts.editData', { id: postId, userId: user.id })
    if (loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const f = await form(c.req.raw)
    const itemIndex = Number(f.item)
    const body = Number.isInteger(itemIndex) && itemIndex >= 0 ? toggleTodo(loaded.post.body, itemIndex) : null
    if (!body) return c.text('Invalid todo item', 400)
    const result = await databaseService().call('api.updatePost', {
      userId: user.id,
      id: postId,
      body,
      origin: new URL(c.req.url).origin,
      translation: await postTranslation(body),
      moderationCategory: loaded.post.moderation_category,
      moderationScore: loaded.post.moderation_score,
    })
    if (result.status !== 'ready') {
      return c.text(result.status === 'not_found' ? 'Not found' : 'Forbidden',
        result.status === 'not_found' ? 404 : 403)
    }
    const requested = f.from ? safeNext(f.from) : `/post/${postId}`
    const target = new URL(requested, 'http://textlog.local')
    return redirect(`${target.pathname}${target.search}#post-${postId}`)
  })

  app.post('/post/:id/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const id = Number(c.req.param('id'))
    const moderator = isAdmin(user)
    const loaded = Number.isInteger(id)
      ? await databaseService().call('posts.editData', {
        id,
        userId: user.id,
        moderator,
      })
      : null
    if (!loaded || loaded.status === 'not_found') return c.text('Not found', 404)
    if (loaded.status === 'forbidden') return c.text('Forbidden', 403)
    const { post, parent } = loaded
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const body = normalizePostBody(f.body || '')
    const moderating = user.id !== post.user_id
    if (f.action === 'unpublish') {
      if (moderating) return c.text('Forbidden', 403)
      const result = await databaseService().call('api.unpublishPost', { userId: user.id, id, body })
      if (result.status !== 'ready') {
        return c.text(result.status === 'not_found' ? 'Not found' : 'Forbidden',
          result.status === 'not_found' ? 404 : 403)
      }
      await deleteImagesAfterCommit(result.imageKeys)
      return redirect('/drafts')
    }
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath} moderator={moderating}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (f.action === 'autotag') {
      const result = await autotagText(body)
      const enrichedBody = result.ok ? normalizePostBody(result.body) : body
      const valid = result.ok && validPostBody(enrichedBody)
      return page(<EditPost user={user} post={post} parent={parent} body={valid ? enrichedBody : body}
        returnPath={returnPath} moderator={moderating} error={result.ok && !valid
          ? `The message is too big to autotag within the ${POST_MAX}-character limit. Edit it down and try again.`
          : result.ok ? undefined : result.message} />, result.ok ? 200 : 503)
    }
    if (!validPostBody(body)) {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath} moderator={moderating}
          error={postBodyValidationMessage(body)} />,
        400,
      )
    }
    if (f.action === 'preview') {
      return page(
        <EditPost user={user} post={post} parent={parent} body={body} preview returnPath={returnPath}
          moderator={moderating} previewExecutionOutput={await executePostCode(body)}
          previewLocation={await previewLocation(body)} />,
      )
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath} moderator={moderating}
            error={moderationMessage(moderation)} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = await databaseService().call('api.updatePost', {
        userId: user.id,
        id,
        body,
        origin: new URL(c.req.url).origin,
        moderator,
        translation: await postTranslation(body),
        moderationCategory: moderation.warning?.category,
        moderationScore: moderation.warning?.score,
        executionOutput: await executePostCode(body),
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
        <EditPost user={user} post={post} parent={parent} body={body} returnPath={returnPath} moderator={moderating}
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
    const editingDraftId = draftId(f)
    const suggestionSearch = await postingSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Reply user={user} post={parent} showForm body={body} draftId={editingDraftId} returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    if (f.action === 'autotag') {
      const result = await autotagText(body)
      const enrichedBody = result.ok ? normalizePostBody(result.body) : body
      const valid = result.ok && validPostBody(enrichedBody)
      return page(<Reply user={user} post={parent} showForm body={valid ? enrichedBody : body}
        draftId={editingDraftId} returnPath={returnPath} error={result.ok && !valid
          ? `The message is too big to autotag within the ${POST_MAX}-character limit. Edit it down and try again.`
          : result.ok ? undefined : result.message} />, result.ok ? 200 : 503)
    }
    if (!validPostBody(body)) {
      return page(
        <Reply user={user} post={parent} showForm error={postBodyValidationMessage(body)} body={body}
          draftId={editingDraftId} returnPath={returnPath} />,
        400,
      )
    }
    if (f.action === 'preview') {
      const result = await databaseService().call('drafts.save', {
        id: editingDraftId ?? null,
        userId: user.id,
        parentId,
        body,
      })
      if (result.status === 'not_found') return c.text('Not found', 404)
      user.draft_count = Math.max(user.draft_count || 0, 1)
      return page(
        <Reply user={user} post={parent} showForm body={body} draftId={result.id} preview
          previewExecutionOutput={await executePostCode(body)} previewLocation={await previewLocation(body)}
          returnPath={returnPath} />,
      )
    }
    if (f.action === 'draft') {
      const result = await databaseService().call('drafts.save', {
        id: editingDraftId ?? null,
        userId: user.id,
        parentId,
        body,
      })
      if (result.status === 'not_found') return c.text('Not found', 404)
      const draftReturnPath = returnPath || `/post/${parentId}`
      return redirect(`/drafts?from=${encodeURIComponent(draftReturnPath)}`)
    }
    try {
      const moderation = await moderateText(body)
      if (!moderation.ok) {
        return page(
          <Reply user={user} post={parent} showForm error={moderationMessage(moderation)} body={body}
            draftId={editingDraftId} returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
      const result = await databaseService().call('api.createPost', {
        userId: user.id,
        body,
        parentId,
        origin: new URL(c.req.url).origin,
        translation: await postTranslation(body),
        moderationCategory: moderation.warning?.category,
        moderationScore: moderation.warning?.score,
        executionOutput: await executePostCode(body),
      })
      if (result.status === 'locked') return c.text('This thread is locked', 409)
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
      if (!result.duplicate) notifyPost()
      if (editingDraftId) await databaseService().call('drafts.delete', { id: editingDraftId, userId: user.id })
      return redirect(postedReplyPath(parentId, result.id, returnPath))
    }
    catch (error) {
      logError(`POST /post/${parentId}/reply`, error)
      return page(
        <Reply user={user} post={parent} showForm error={saveFailureMessage} body={body} draftId={editingDraftId}
          returnPath={returnPath} />,
        500,
      )
    }
  })
}
