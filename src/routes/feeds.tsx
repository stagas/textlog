import {
  About,
  Activity,
  activityTotal,
  Contact,
  Feed,
  HotFeed,
  Legal,
  PublicFeed,
} from '../components/pages'
import { currentPage, page, paginationRedirect, redirect, rememberFeed, visiblePostCount } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import {
  feedPreference,
} from '../http'
import { currentUser } from '../utils'
import { decodeHotCursor } from '../hot'

export function registerFeedsRoutes(app: Hono) {
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
      const cursorValue = c.req.query('cursor')
      const cursor = decodeHotCursor(cursorValue)
      if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
      return page(<HotFeed user={user} cursor={cursor} path="/" />)
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
    return rememberFeed(page(<Feed user={user} page={feedPage} title="for you" />), 'following')
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
    const cursorValue = c.req.query('cursor')
    const cursor = decodeHotCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<HotFeed user={user} cursor={cursor} title="hot" />), 'hot')
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
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
