import {
  About,
  Activity,
  Contact,
  decodeForYouCursor,
  Dmca,
  Feed,
  HotFeed,
  Legal,
  PublicFeed,
} from '../components/pages'
import { page, redirect, rememberFeed } from './shared'

import type { Hono } from 'hono'
import { decodeActivityCursor } from '../activity-order'
import { decodeHotCursor } from '../hot'
import {
  feedPreference,
  notificationBannerDismissed,
  notificationBannerDismissedCookie,
  notificationDevice,
  safeRefererPath,
} from '../http'
import { decodePostCursor } from '../pagination'
import { currentUser } from '../utils'
import { markAllActivityRead } from '../activity-state'
import { markAllForYouRead } from '../for-you-state'
import { db } from '../db'

function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user || notificationBannerDismissed(request, user.id)) return false
  const deviceId = notificationDevice(request)
  if (!deviceId) return true
  return !db.query('SELECT 1 FROM push_subscriptions WHERE user_id=? AND device_id=? LIMIT 1')
    .get(user.id, deviceId)
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
      return page(<PublicFeed user={user} cursor={cursor} path="/" pageUrl={pageUrl}
        notificationBanner={notificationBanner} />)
    }
    if (preferredFeed === 'hot' || !user) {
      const cursorValue = c.req.query('cursor')
      const cursor = decodeHotCursor(cursorValue)
      if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
      return page(<HotFeed user={user} cursor={cursor} path="/" pageUrl={pageUrl}
        notificationBanner={notificationBanner} />)
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodeForYouCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return page(<Feed user={user} cursor={cursor} path="/" pageUrl={pageUrl}
      notificationBanner={notificationBanner} />)
  })

  app.get('/for-you', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    const cursorValue = c.req.query('cursor')
    const cursor = decodeForYouCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<Feed user={user} cursor={cursor} title="for you"
      notificationBanner={showNotificationBanner(c.req.raw, user)} />), 'following')
  })

  app.get('/latest', c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<PublicFeed user={user} cursor={cursor} path="/latest"
      notificationBanner={showNotificationBanner(c.req.raw, user)} />), 'latest')
  })

  app.post('/for-you/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    markAllForYouRead(user.id)
    return redirect('/for-you')
  })

  app.get('/hot', c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    const cursor = decodeHotCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return rememberFeed(page(<HotFeed user={user} cursor={cursor} title="hot"
      notificationBanner={showNotificationBanner(c.req.raw, user)} />), 'hot')
  })

  app.post('/notifications/banner/dismiss', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const destination = safeRefererPath(c.req.header('referer'), c.req.url)
    return redirect(destination, notificationBannerDismissedCookie(user.id))
  })

  app.get('/activity', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    const cursorValue = c.req.query('cursor')
    const cursor = decodeActivityCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    return page(<Activity user={user} cursor={cursor} />)
  })

  app.post('/activity/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/activity'))
    markAllActivityRead(user.id)
    return redirect('/activity')
  })

  app.get('/about', c => page(<About user={currentUser(c.req.raw)} />))
  app.get('/contact', c => page(<Contact user={currentUser(c.req.raw)} />))
  app.get('/dmca', c => page(<Dmca user={currentUser(c.req.raw)} />))
  app.get('/legal', c => page(<Legal user={currentUser(c.req.raw)} />))
}
