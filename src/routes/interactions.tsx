import { form, page, redirect, usersBlocked } from './shared'

import type { Hono } from 'hono'
import {
  Explore,
} from '../components/pages'
import { db } from '../db'
import { resolveHandle } from '../handles'
import {
  safeRefererPath,
} from '../http'
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
      ? db.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
        .get(postId) as { user_id: number } | null
      : null
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
    if (!user) return redirect('/enter')
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]{1,280}$/.test(tag)) return c.text('Invalid tag', 400)
    const exists = db.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?').get(user.id, tag)
    exists
      ? db.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(user.id, tag)
      : db.query('INSERT OR IGNORE INTO hashtag_follows VALUES(?,?)').run(user.id, tag)
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url, '/tag/' + tag))
  })

  app.post('/tag-block/:tag', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const tag = c.req.param('tag').toLowerCase()
    if (!/^[a-z0-9_]{1,280}$/.test(tag)) return c.text('Invalid tag', 400)
    const exists = db.query('SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?').get(user.id, tag)
    db.transaction(() => {
      if (exists) db.query('DELETE FROM blocked_hashtags WHERE user_id=? AND tag=?').run(user.id, tag)
      else {
        db.query('INSERT INTO blocked_hashtags(user_id,tag) VALUES(?,?)').run(user.id, tag)
        db.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(user.id, tag)
      }
    })()
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
}
