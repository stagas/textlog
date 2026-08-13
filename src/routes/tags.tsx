import { currentPage, page, paginationRedirect, safeNext } from './shared'

import type { Hono } from 'hono'
import { appName } from '../brand'
import {
  TagFeed,
} from '../components/pages'
import { db } from '../db'
import { devicePageSize } from '../device-settings'
import { renderTagOg } from '../og'
import { CONNECTION_PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PersonView, PostView } from '../types'
import { currentUser } from '../utils'

export function registerTagsRoutes(app: Hono) {
  app.get('/tag/:tag/og.png', c => {
    const tag = c.req.param('tag').toLowerCase()
    const total = (db.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
    WHERE ph.tag=? AND p.deleted_at IS NULL`)
      .get(tag) as { count: number }).count
    const image = renderTagOg(tag, total)
    const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(image.byteLength),
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  })

  app.get('/tag/:tag', c => {
    const requestedTag = c.req.param('tag')
    const tag = requestedTag.toLowerCase()
    if (requestedTag !== tag) {
      return c.redirect(`/tag/${encodeURIComponent(tag)}${new URL(c.req.url).search}`, 301)
    }
    const user = currentUser(c.req.raw)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const tagPage = currentPage(c.req.query('page'))
    const tab = c.req.query('tab')
    if (tab && tab !== 'followers') return c.notFound()
    const following = !!user && !!db.query(
      'SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?',
    ).get(user.id, tag)
    const blocked = !!user && !!db.query('SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?').get(user.id, tag)
    const viewerId = user?.id ?? -1
    const notePageSize = devicePageSize(c.req.raw, user?.id)
    const posts = blocked ? [] : enrichPosts(db, db.query(
      `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id JOIN post_hashtags ph ON ph.post_id=p.id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).all(tag, viewerId, viewerId, viewerId, notePageSize, (tagPage - 1) * notePageSize) as PostView[], viewerId)
    const total = blocked
      ? 0
      : (db.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
        .get(tag, viewerId, viewerId, viewerId) as { count: number }).count
    const followerTotal = (db.query(`SELECT count(*) count FROM hashtag_follows hf JOIN users u ON u.id=hf.user_id
      WHERE hf.tag=? AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`)
      .get(tag, viewerId, viewerId, viewerId) as { count: number }).count
    const people = tab === 'followers'
      ? db.query(`SELECT u.*,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) viewerFollowing
        FROM hashtag_follows hf JOIN users u ON u.id=hf.user_id
        WHERE hf.tag=? AND u.deleted_at IS NULL AND u.suspended_at IS NULL
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
        ORDER BY u.handle LIMIT ? OFFSET ?`)
        .all(viewerId, tag, viewerId, viewerId, viewerId, CONNECTION_PAGE_SIZE,
          (tagPage - 1) * CONNECTION_PAGE_SIZE) as PersonView[]
      : []
    const tabPath = `/tag/${encodeURIComponent(tag)}${tab === 'followers' ? '?tab=followers' : ''}`
    const outOfRange = paginationRedirect(tagPage, tab === 'followers' ? followerTotal : total, tabPath,
      tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize)
    if (outOfRange) return outOfRange
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const tagUrl = `${origin}/tag/${encodeURIComponent(tag)}`
    const description = `${total} ${total === 1 ? 'note' : 'notes'} tagged #${tag} on ${appName()}`
    const social = {
      description,
      image: `${tagUrl}/og.png?v=2`,
      url: tagUrl,
      type: 'website' as const,
      imageAlt: `#${tag}: ${description}`,
    }
    return page(
      <TagFeed user={user} tag={tag} following={following} blocked={blocked} posts={posts} page={tagPage} total={total}
        followerTotal={followerTotal} people={people} tab={tab === 'followers' ? 'followers' : 'notes'}
        notePageSize={notePageSize} social={social} returnPath={returnPath} />,
    )
  })
}
