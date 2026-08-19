import { clientErrorPage, currentPage, form, page, redirect, safeNext } from './shared'

import type { Hono } from 'hono'
import {
  Explore,
  Reply,
} from '../components/pages'
import { isValidHashtag, normalizeHashtag } from '../content'
import { databaseService } from '../database-service'
import {
  safeRefererPath,
} from '../http'
import { logError } from '../log'
import { sendPushForFollow, sendPushForTagFollow, sendPushForUserFollow } from '../push'
import { currentUser } from '../utils'

export function registerInteractionsRoutes(app: Hono) {
  app.post('/follow/:handle', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const handle = c.req.param('handle').toLowerCase()
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) return c.text('Invalid handle', 400)
    const f = await form(c.req.raw)
    const result = await databaseService().call('interactions.toggleFollow', { userId: user.id, handle })
    if (result?.followed) {
      void sendPushForFollow(user.id, user.handle, result.targetId)
        .catch(error => logError('follow push failed', error))
      void sendPushForUserFollow(user.id, user.handle, result.targetId, result.targetHandle)
        .catch(error => logError('follow activity push failed', error))
    }
    const referer = c.req.header('referer')
    const returnPath = f.from ? safeNext(f.from) : safeRefererPath(referer, c.req.url)
    if (referer && URL.canParse(referer)) {
      const url = new URL(referer)
      if (url.pathname === '/explore' && /^\d+(,\d+){0,7}$/.test(f.explorePeople || '')) {
        return redirect(returnPath, `explore_people=${f.explorePeople}; HttpOnly; Path=/explore; SameSite=Lax`)
      }
    }
    return redirect(returnPath)
  })

  app.post('/block/:handle', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const handle = c.req.param('handle').toLowerCase()
    const result = await databaseService().call('interactions.toggleBlock', { userId: user.id, handle })
    if (!result) return c.text('Not found', 404)
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/u/' + result.targetHandle))
  })

  app.post('/post/:id/report', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const postId = Number(c.req.param('id'))
    const f = await form(c.req.raw)
    const validReason = ['harassment', 'spam', 'impersonation', 'other'].includes(f.reason)
    const result = await databaseService().call('interactions.reportPost', {
      userId: user.id,
      postId,
      reason: validReason ? f.reason : null,
    })
    if (result.status === 'not_found') return c.text('Not found', 404)
    if (result.status === 'own_post') return c.text('You cannot report your own post', 400)
    if (!validReason) {
      return page(
        <Reply user={user} post={result.post!} replies={await databaseService().call('posts.threadReplies', {
          parentId: result.post!.id,
          viewerId: user.id,
        })} showForm={false} showReport reportReason={f.reason || ''}
          reportError="Choose a valid reason for the report." />,
        400,
      )
    }
    return redirect(`/post/${postId}?reported=1`)
  })

  app.post('/tag-follow/:tag', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const tag = normalizeHashtag(c.req.param('tag'))
    if (!isValidHashtag(tag)) return clientErrorPage(c.req.raw)
    const contentType = c.req.header('content-type') || ''
    const f = /^(application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/i.test(contentType)
      ? await form(c.req.raw)
      : {} as Record<string, string>
    const result = await databaseService().call('interactions.toggleTagFollow', { userId: user.id, tag })
    if (result.followed) {
      void sendPushForTagFollow(user.id, user.handle, tag)
        .catch(error => logError('tag follow activity push failed', error))
    }
    return redirect(f.from
      ? safeNext(f.from)
      : safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + encodeURIComponent(tag)))
  })

  app.post('/tag-block/:tag', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const tag = normalizeHashtag(c.req.param('tag'))
    if (!isValidHashtag(tag)) return clientErrorPage(c.req.raw)
    await databaseService().call('interactions.toggleTagBlock', { userId: user.id, tag })
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + encodeURIComponent(tag)))
  })

  app.get('/explore', async c => {
    const savedPeople = c.req.header('cookie')?.match(/(?:^|;\s*)explore_people=([\d,]+)/)?.[1]
    const peopleIds = savedPeople?.split(',').map(Number)
    const user = currentUser(c.req.raw)
    const tagsPage = currentPage(c.req.query('tagsPage'))
    const peoplePage = currentPage(c.req.query('peoplePage'))
    const data = await databaseService().call('explore.page', {
      viewerId: user?.id ?? -1,
      peopleIds,
      tagsPage,
      peoplePage,
    })
    const response = page(
      <Explore user={user} welcome={c.req.query('welcome') === '1'} tagsPage={tagsPage} peoplePage={peoplePage}
        data={data} />,
    )
    if (savedPeople) {
      response.headers.append('set-cookie', 'explore_people=; Max-Age=0; Path=/explore; HttpOnly; SameSite=Lax')
    }
    return response
  })
}
