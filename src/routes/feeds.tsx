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
import { materializedFeedPage } from '../materialized-feed-pages'
import {
  feedPreference,
  notificationBannerDismissed,
  notificationUserAgent,
  safeRefererPath,
} from '../http'
import { decodePostCursor } from '../pagination'
import { currentUser } from '../utils'

function showNotificationBanner(request: Request, user: ReturnType<typeof currentUser>) {
  if (!user) return false
  const userAgent = notificationUserAgent(request)
  if (!userAgent) return Math.random() < 0.5 ? 'notifications' : 'appearance'
  const notificationsEnabled = Boolean(db.query(
    "SELECT 1 FROM notification_user_agents WHERE user_id=? AND user_agent=? AND status='enabled' LIMIT 1",
  ).get(user.id, userAgent))
  const improvementDismissed = Boolean(db.query(
    'SELECT 1 FROM notification_improvement_user_agents WHERE user_id=? AND user_agent=? LIMIT 1',
  ).get(user.id, userAgent))
  if (notificationsEnabled && !improvementDismissed) return 'notification-update'
  const notificationsHandled = notificationBannerDismissed(request, user.id) || Boolean(db.query(
    'SELECT 1 FROM notification_user_agents WHERE user_id=? AND user_agent=? LIMIT 1',
  ).get(user.id, userAgent))
  const appearanceHandled = Boolean(db.query(
    'SELECT 1 FROM appearance_user_agents WHERE user_id=? AND user_agent=? LIMIT 1',
  ).get(user.id, userAgent))
  if (notificationsHandled && appearanceHandled) return false
  if (notificationsHandled) return 'appearance'
  if (appearanceHandled) return 'notifications'
  return Math.random() < 0.5 ? 'notifications' : 'appearance'
}

function rememberAppearanceBanner(request: Request, userId: number, status: 'seen' | 'dismissed') {
  const userAgent = notificationUserAgent(request)
  if (!userAgent) return
  db.query(`INSERT INTO appearance_user_agents(user_id,user_agent,status) VALUES(?,?,?)
    ON CONFLICT(user_id,user_agent) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP`)
    .run(userId, userAgent, status)
}

export function registerFeedsRoutes(app: Hono) {
  app.get('/', c => {
    const user = currentUser(c.req.raw)
    const preferredFeed = feedPreference(c.req.raw)
    const path = preferredFeed === 'latest' ? '/latest'
      : preferredFeed === 'hot' || !user ? '/hot' : '/for-you'
    return redirect(path + new URL(c.req.url).search)
  })

  app.get('/for-you', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = showNotificationBanner(c.req.raw, user)
    const render = () => page(
        <Feed user={user} page={currentPage(c.req.query('page'))} title="for you"
          notificationBanner={notificationBanner} />,
    )
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue
      ? await materializedFeedPage(db, c.req.raw, 'for-you', user.id, render, undefined, true)
      : render()
    return rememberFeed(response, 'following')
  })

  app.get('/latest', async c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const notificationBanner = showNotificationBanner(c.req.raw, user)
    const render = () => page(
      <PublicFeed user={user} page={currentPage(c.req.query('page'))} path="/latest"
        notificationBanner={notificationBanner} />,
    )
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue
      ? await materializedFeedPage(db, c.req.raw, 'latest', user?.id ?? -1, render)
      : render()
    return rememberFeed(response, 'latest')
  })

  app.post('/for-you/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/for-you'))
    markAllForYouRead(user.id)
    return redirect('/for-you')
  })

  app.get('/to-me', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeForYouCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = showNotificationBanner(c.req.raw, user)
    const render = () => page(
        <Feed user={user} page={currentPage(c.req.query('page'))} title="to me" path="/to-me" toMe
          notificationBanner={notificationBanner} />,
    )
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue
      ? await materializedFeedPage(db, c.req.raw, 'to-me', user.id, render, undefined, true)
      : render()
    return rememberFeed(response, 'following')
  })

  app.post('/to-me/read-all', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/to-me'))
    markAllForYouRead(user.id, true)
    return redirect('/to-me')
  })

  app.get('/hot', async c => {
    const user = currentUser(c.req.raw)
    const cursorValue = c.req.query('cursor')
    if (cursorValue && !decodeHotCursor(cursorValue)) return c.text('Invalid cursor', 400)
    const notificationBanner = showNotificationBanner(c.req.raw, user)
    const render = () => page(
      <HotFeed user={user} page={currentPage(c.req.query('page'))} title="hot"
        notificationBanner={notificationBanner} />,
    )
    const response = !notificationBanner && currentPage(c.req.query('page')) === 1 && !cursorValue
      ? await materializedFeedPage(db, c.req.raw, 'hot', user?.id ?? -1, render)
      : render()
    return rememberFeed(response, 'hot')
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

  app.post('/notifications/improvements/dismiss', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`INSERT INTO notification_improvement_user_agents(user_id,user_agent) VALUES(?,?)
        ON CONFLICT(user_id,user_agent) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`)
        .run(user.id, userAgent)
    }
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
  })

  app.post('/appearance/banner/dismiss', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    rememberAppearanceBanner(c.req.raw, user.id, 'dismissed')
    return redirect(safeRefererPath(c.req.header('referer'), c.req.url))
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
