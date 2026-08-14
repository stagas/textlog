import {
  About,
  Contact,
  decodeForYouCursor,
  Dmca,
  Feed,
  HotFeed,
  Legal,
  PublicFeed,
} from '../components/pages'
import { currentPage, page, redirect, rememberFeed } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { markAllForYouRead } from '../for-you-state'
import { decodeHotCursor } from '../hot'
import {
  feedPreference,
  notificationBannerDismissed,
  notificationUserAgent,
  safeRefererPath,
} from '../http'
import { decodePostCursor } from '../pagination'
import { currentUser } from '../utils'

function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user || notificationBannerDismissed(request, user.id)) return false
  const userAgent = notificationUserAgent(request)
  if (!userAgent) return true
  return !db.query('SELECT 1 FROM notification_user_agents WHERE user_id=? AND user_agent=? LIMIT 1')
    .get(user.id, userAgent)
}

export function registerFeedsRoutes(app: Hono) {
  app.get('/', c => {
    const user = currentUser(c.req.raw)
    const notificationBanner = showNotificationBanner(c.req.raw, user)
    const requestUrl = new URL(c.req.url)
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const pageUrl = `${configuredOrigin || requestUrl.origin}/${requestUrl.search}`
    const preferredFeed = feedPreference(c.req.raw)
    if (preferredFeed === 'latest') {
      const cursorValue = c.req.query('cursor')
      const cursor = decodePostCursor(cursorValue)
      if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
      return page(
        <PublicFeed user={user} page={currentPage(c.req.query('page'))} path="/" pageUrl={pageUrl}
          notificationBanner={notificationBanner} />,
      )
    }
    if (preferredFeed === 'hot' || !user) {
      const cursorValue = c.req.query('cursor')
      if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
      return page(
        <HotFeed user={user} page={currentPage(c.req.query('page'))} path="/" pageUrl={pageUrl}
          notificationBanner={notificationBanner} />,
      )
    }
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    return page(
      <Feed user={user} page={currentPage(c.req.query('page'))} path="/" pageUrl={pageUrl}
        notificationBanner={notificationBanner} />,
    )
  })

  app.get('/for-you', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    return rememberFeed(
      page(
        <Feed user={user} page={currentPage(c.req.query('page'))} title="for you"
          notificationBanner={showNotificationBanner(c.req.raw, user)} />,
      ),
      'following',
    )
  })

  app.get('/latest', c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(
      page(
        <PublicFeed user={user} page={currentPage(c.req.query('page'))} path="/latest"
          notificationBanner={showNotificationBanner(c.req.raw, user)} />,
      ),
      'latest',
    )
  })

  app.post('/for-you/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    markAllForYouRead(user.id)
    return redirect('/for-you')
  })

  app.get('/to-me', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    return rememberFeed(
      page(
        <Feed user={user} page={currentPage(c.req.query('page'))} title="to me" path="/to-me" toMe
          notificationBanner={showNotificationBanner(c.req.raw, user)} />,
      ),
      'following',
    )
  })

  app.post('/to-me/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    markAllForYouRead(user.id, true)
    return redirect('/to-me')
  })

  app.get('/hot', c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
    return rememberFeed(
      page(
        <HotFeed user={user} page={currentPage(c.req.query('page'))} title="hot"
          notificationBanner={showNotificationBanner(c.req.raw, user)} />,
      ),
      'hot',
    )
  })

  app.post('/notifications/banner/dismiss', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const destination = safeRefererPath(c.req.header('referer'), c.req.url)
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'dismissed')
        ON CONFLICT(user_id,user_agent) DO UPDATE SET status='dismissed',updated_at=CURRENT_TIMESTAMP`)
        .run(user.id, userAgent)
    }
    return redirect(destination)
  })

  app.get('/activity', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    return redirect('/to-me')
  })

  app.post('/activity/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    markAllForYouRead(user.id, true)
    return redirect('/to-me')
  })

  app.get('/about', c => page(<About user={currentUser(c.req.raw)} />))
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
