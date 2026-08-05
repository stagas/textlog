import {
  About,
  Activity,
  activityTotal,
  Contact,
  Dmca,
  Feed,
  HotFeed,
  Legal,
  PublicFeed,
} from '../components/pages'
import { currentPage, page, paginationRedirect, redirect, rememberFeed } from './shared'

import type { Hono } from 'hono'
import { decodeHotCursor } from '../hot'
import {
  feedPreference,
} from '../http'
import { decodePostCursor } from '../pagination'
import { currentUser } from '../utils'

export function registerFeedsRoutes(app: Hono) {
  app.get('/', c => {
    const user = currentUser(c.req.raw)
    const preferredFeed = feedPreference(c.req.raw)
    if (preferredFeed === 'latest') {
      const cursorValue = c.req.query('cursor')
      const cursor = decodePostCursor(cursorValue)
      if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
      return page(<PublicFeed user={user} cursor={cursor} path="/latest" />)
    }
    if (preferredFeed === 'hot' || !user) {
      const cursorValue = c.req.query('cursor')
      const cursor = decodeHotCursor(cursorValue)
      if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
      return page(<HotFeed user={user} cursor={cursor} path="/" />)
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return page(<Feed user={user} cursor={cursor} path="/" />)
  })

  app.get('/for-you', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<Feed user={user} cursor={cursor} title="for you" />), 'following')
  })

  app.get('/latest', c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<PublicFeed user={user} cursor={cursor} path="/latest" />), 'latest')
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
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    const activityPage = currentPage(c.req.query('page'))
    const outOfRange = paginationRedirect(activityPage, activityTotal(user.id), '/activity')
    if (outOfRange) return outOfRange
    return page(<Activity user={user} page={activityPage} />)
  })

  app.get('/about', c => page(<About user={currentUser(c.req.raw)} />))
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
