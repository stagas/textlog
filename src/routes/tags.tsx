import { currentPage, page, paginationRedirect } from './shared'

import type { Hono } from 'hono'
import {
  TagFeed,
} from '../components/pages'
import { db } from '../db'
import { renderTagOg } from '../og'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
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
    const user = currentUser(c.req.raw)
    const tagPage = currentPage(c.req.query('page'))
    const tag = c.req.param('tag').toLowerCase()
    const following = !!user && !!db.query(
      'SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?',
    ).get(user.id, tag)
    const blocked = !!user && !!db.query('SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?').get(user.id, tag)
    const viewerId = user?.id ?? -1
    const posts = blocked ? [] : enrichPosts(db, db.query(
      `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id JOIN post_hashtags ph ON ph.post_id=p.id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).all(tag, viewerId, viewerId, viewerId, PAGE_SIZE, (tagPage - 1) * PAGE_SIZE) as PostView[], viewerId)
    const total = blocked
      ? 0
      : (db.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
        .get(tag, viewerId, viewerId, viewerId) as { count: number }).count
    const outOfRange = paginationRedirect(tagPage, total, `/tag/${tag}`)
    if (outOfRange) return outOfRange
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const tagUrl = `${origin}/tag/${encodeURIComponent(tag)}`
    const description = `${total} ${total === 1 ? 'note' : 'notes'} tagged #${tag} on textlog`
    const social = {
      description,
      image: `${tagUrl}/og.png?v=2`,
      url: tagUrl,
      type: 'website' as const,
      imageAlt: `#${tag}: ${description}`,
    }
    return page(
      <TagFeed user={user} tag={tag} following={following} blocked={blocked} posts={posts} page={tagPage} total={total}
        social={social} />,
    )
  })
}
