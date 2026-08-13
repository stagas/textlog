import { clientErrorPage, currentPage, form, page, redirect, safeNext, usersBlocked } from './shared'

import type { Hono } from 'hono'
import {
  Explore,
  Reply,
} from '../components/pages'
import { isValidHashtag, normalizeHashtag } from '../content'
import { db } from '../db'
import { resolveHandle } from '../handles'
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
    const target = resolveHandle(db, handle)
    if (target && target.id !== user.id && !usersBlocked(user.id, target.id)) {
      const exists = db.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(user.id, target.id)
      if (exists) db.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(user.id, target.id)
      else {
        const inserted = db.query(
          'INSERT OR IGNORE INTO follows(follower_id,following_id,created_at) VALUES(?,?,CURRENT_TIMESTAMP)',
        ).run(user.id, target.id)
        if (inserted.changes) {
          void sendPushForFollow(user.id, user.handle, target.id)
            .catch(error => logError('follow push failed', error))
          void sendPushForUserFollow(user.id, user.handle, target.id, target.handle)
            .catch(error => logError('follow activity push failed', error))
        }
      }
    }
    const referer = c.req.header('referer')
    const returnPath = f.from ? safeNext(f.from) : safeRefererPath(referer, c.req.url)
    if (referer && URL.canParse(referer)) {
      const url = new URL(referer)
      if (url.pathname === '/explore' && /^\d+(,\d+){0,7}$/.test(f.explorePeople || '')) {
        return redirect(returnPath,
          `explore_people=${f.explorePeople}; HttpOnly; Path=/explore; SameSite=Lax`)
      }
    }
    return redirect(returnPath)
  })

  app.post('/block/:handle', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const handle = c.req.param('handle').toLowerCase()
    const target = resolveHandle(db, handle)
    if (!target || target.id === user.id) return c.text('Not found', 404)
    const exists = db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(user.id, target.id)
    db.transaction(() => {
      if (exists) db.query('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(user.id, target.id)
      else {
        db.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(?,?)').run(user.id, target.id)
        db.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(user.id, target.id)
      }
    })()
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/u/' + target.handle))
  })

  app.post('/post/:id/report', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const postId = Number(c.req.param('id'))
    const post = Number.isInteger(postId)
      ? db.query(`SELECT p.*,u.handle,u.bio FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.deleted_at IS NULL`).get(postId) as import('../types').PostView | null
      : null
    if (!post) return c.text('Not found', 404)
    if (post.user_id === user.id) return c.text('You cannot report your own post', 400)
    if (usersBlocked(user.id, post.user_id)) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    if (!['harassment', 'spam', 'impersonation', 'other'].includes(f.reason)) {
      return page(
        <Reply user={user} post={post} showForm={false} showReport reportReason={f.reason || ''}
          reportError="Choose a valid reason for the report." />,
        400,
      )
    }
    db.query(`INSERT INTO reports(reporter_id,post_id,reason) VALUES(?,?,?)
    ON CONFLICT(reporter_id,post_id) DO UPDATE SET reason=excluded.reason,created_at=CURRENT_TIMESTAMP`)
      .run(user.id, postId, f.reason)
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
    const exists = db.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?').get(user.id, tag)
    if (exists) db.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(user.id, tag)
    else {
      const inserted = db.query(`INSERT OR IGNORE INTO hashtag_follows(user_id,tag,created_at)
        VALUES(?,?,CURRENT_TIMESTAMP)`).run(user.id, tag)
      if (inserted.changes) {
        void sendPushForTagFollow(user.id, user.handle, tag)
          .catch(error => logError('tag follow activity push failed', error))
      }
    }
    return redirect(f.from ? safeNext(f.from)
      : safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + encodeURIComponent(tag)))
  })

  app.post('/tag-block/:tag', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const tag = normalizeHashtag(c.req.param('tag'))
    if (!isValidHashtag(tag)) return clientErrorPage(c.req.raw)
    const exists = db.query('SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?').get(user.id, tag)
    db.transaction(() => {
      if (exists) db.query('DELETE FROM blocked_hashtags WHERE user_id=? AND tag=?').run(user.id, tag)
      else {
        db.query('INSERT INTO blocked_hashtags(user_id,tag) VALUES(?,?)').run(user.id, tag)
        db.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(user.id, tag)
      }
    })()
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + encodeURIComponent(tag)))
  })

  app.get('/explore', c => {
    const savedPeople = c.req.header('cookie')?.match(/(?:^|;\s*)explore_people=([\d,]+)/)?.[1]
    const peopleIds = savedPeople?.split(',').map(Number)
    const response = page(
      <Explore user={currentUser(c.req.raw)} welcome={c.req.query('welcome') === '1'} peopleIds={peopleIds}
        tagsPage={currentPage(c.req.query('tagsPage'))} peoplePage={currentPage(c.req.query('peoplePage'))} />,
    )
    if (savedPeople) {
      response.headers.append('set-cookie', 'explore_people=; Max-Age=0; Path=/explore; HttpOnly; SameSite=Lax')
    }
    return response
  })
}
