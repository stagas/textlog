import {
  Connections,
  Profile,
} from '../components/pages'
import type { PersonView, PostView, ProfileRow } from '../types'
import { currentPage, notFoundPage, page, paginationRedirect, redirect } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { resolveHandle } from '../handles'
import { renderProfileOg } from '../og'
import { CONNECTION_PAGE_SIZE, decodePostCursor, PAGE_SIZE, postCursorPage } from '../pagination'
import { enrichPosts } from '../posts'
import { currentUser } from '../utils'

export function registerProfilesRoutes(app: Hono) {
  app.get('/u/:handle/og.png', c => {
    const resolved = resolveHandle(db, c.req.param('handle'))
    if (!resolved) return c.text('Not found', 404)
    if (resolved.alias) {
      return c.redirect(`/u/${resolved.handle}/og.png`, 301)
    }
    const profile = db.query(
      `SELECT u.handle,u.bio,
      (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) notes,
      (SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following,
      (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) followingTags,
      (SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers
      FROM users u WHERE u.id=? AND u.deleted_at IS NULL`,
    ).get(resolved.id) as {
      handle: string
      bio: string
      notes: number
      following: number
      followingTags: number
      followers: number
    } | null
    if (!profile) return c.text('Not found', 404)
    const image = renderProfileOg(profile.handle, profile.bio, profile)
    const body = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(image.byteLength),
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  })

  app.get('/u/:handle/:kind', c => {
    const kind = c.req.param('kind')
    if (kind !== 'following' && kind !== 'followers' && kind !== 'blocked') return notFoundPage(c.req.raw)
    const resolved = resolveHandle(db, c.req.param('handle'))
    if (!resolved) return notFoundPage(c.req.raw)
    const pageQuery = c.req.query('page') ? `&page=${encodeURIComponent(c.req.query('page')!)}` : ''
    return redirect(`/u/${resolved.handle}?tab=${kind}${pageQuery}`)
  })

  app.get('/u/:handle', c => {
    const requestedHandle = c.req.param('handle')
    const resolved = resolveHandle(db, requestedHandle)
    if (!resolved) return notFoundPage(c.req.raw)
    if (resolved.alias) {
      return c.redirect(`/u/${resolved.handle}${new URL(c.req.url).search}`, 301)
    }
    const user = currentUser(c.req.raw)
    const profilePage = currentPage(c.req.query('page'))
    const profile = db.query(
      'SELECT id,handle,email,bio,suspended_at,deleted_at FROM users WHERE id=? AND deleted_at IS NULL',
    ).get(resolved.id) as ProfileRow
    const tab = c.req.query('tab')
    if (tab && tab !== 'following' && tab !== 'followers' && tab !== 'blocked') return notFoundPage(c.req.raw)
    if (tab === 'blocked' && user?.id !== profile.id) return notFoundPage(c.req.raw)
    const total =
      (db.query('SELECT count(*) AS count FROM posts WHERE user_id=? AND deleted_at IS NULL').get(profile.id) as {
        count: number
      }).count
    const following = !!user
      && !!db.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(user.id, profile.id)
    const blocked = !!user
      && !!db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(user.id, profile.id)
    const blockedByProfile = !!user
      && !!db.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(profile.id, user.id)
    const viewerId = user?.id ?? -1
    const counts = db.query(
      `SELECT
      (SELECT count(*) FROM follows f WHERE following_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
          OR (b.blocker_id=f.follower_id AND b.blocked_id=?)))) followerCount,
      (SELECT count(*) FROM follows f WHERE follower_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.following_id)
          OR (b.blocker_id=f.following_id AND b.blocked_id=?)))) followingCount,
      (SELECT count(*) FROM hashtag_follows WHERE user_id=?) followingTagCount`,
    ).get(profile.id, viewerId, viewerId, viewerId, profile.id, viewerId, viewerId, viewerId, profile.id) as {
      followerCount: number
      followingCount: number
      followingTagCount: number
    }
    const blockCounts = user?.id === profile.id
      ? db.query(`SELECT (SELECT count(*) FROM blocks WHERE blocker_id=?) blockedPeople,
        (SELECT count(*) FROM blocked_hashtags WHERE user_id=?) blockedTags`).get(profile.id, profile.id) as {
        blockedPeople: number
        blockedTags: number
      }
      : { blockedPeople: 0, blockedTags: 0 }
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const profileUrl = `${origin}/u/${profile.handle}`
    const description = profile.bio.replace(/\s+/g, ' ').trim() || `@${profile.handle} on textlog`
    const social = {
      description,
      image: `${profileUrl}/og.png?v=2`,
      url: profileUrl,
      type: 'profile' as const,
      imageAlt: `Profile for @${profile.handle}: ${description}`,
    }
    if (blocked || blockedByProfile) {
      return page(
        <Profile user={user} profile={profile} posts={[]} following={false} blocked={blocked}
          blockedByProfile={blockedByProfile} total={0} followerCount={0} followingCount={0} followingTagCount={0}
          social={social} />,
      )
    }
    if (tab === 'blocked') {
      const people = db.query(`SELECT u.*,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts
        FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=?
        ORDER BY u.handle LIMIT ? OFFSET ?`).all(profile.id, PAGE_SIZE, (profilePage - 1) * PAGE_SIZE) as PersonView[]
      const tags = db.query(`SELECT bh.tag,
        (SELECT count(*) FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
          WHERE ph.tag=bh.tag AND p.deleted_at IS NULL) count
        FROM blocked_hashtags bh WHERE bh.user_id=? ORDER BY bh.tag`).all(profile.id) as {
        tag: string
        count: number
        viewerFollowing: boolean
      }[]
      const outOfRange = paginationRedirect(profilePage, blockCounts.blockedPeople, `/u/${profile.handle}?tab=blocked`)
      if (outOfRange) return outOfRange
      return page(
        <Connections user={user} profile={profile} people={people} tags={tags} kind="blocked" page={profilePage}
          total={blockCounts.blockedPeople} noteCount={total} {...counts} following={following}
          blockedPeopleCount={blockCounts.blockedPeople} blockedTagCount={blockCounts.blockedTags} social={social} />,
      )
    }
    if (tab === 'following' || tab === 'followers') {
      const join = tab === 'following'
        ? 'JOIN follows f ON f.following_id=u.id WHERE f.follower_id=?'
        : 'JOIN follows f ON f.follower_id=u.id WHERE f.following_id=?'
      const people = db.query(
        `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing
        FROM users u ${join} AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
        ORDER BY u.handle LIMIT ? OFFSET ?`,
      ).all(viewerId, profile.id, viewerId, viewerId, viewerId, CONNECTION_PAGE_SIZE,
        (profilePage - 1) * CONNECTION_PAGE_SIZE) as PersonView[]
      const countWhere = tab === 'following' ? 'follower_id=?' : 'following_id=?'
      const counterpart = tab === 'following' ? 'f.following_id' : 'f.follower_id'
      const connectionTotal = (db.query(`SELECT count(*) AS count FROM follows f WHERE ${countWhere}
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=${counterpart}) OR (b.blocker_id=${counterpart} AND b.blocked_id=?)))`)
        .get(profile.id, viewerId, viewerId, viewerId) as { count: number }).count
      const outOfRange = paginationRedirect(profilePage, connectionTotal, `/u/${profile.handle}?tab=${tab}`)
      if (outOfRange) return outOfRange
      const tags = tab === 'following'
        ? db.query(
          `SELECT hf.tag,
          (SELECT count(*) FROM post_hashtags ph JOIN posts hp ON hp.id=ph.post_id
            WHERE ph.tag=hf.tag AND hp.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
              (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=hp.user_id)
                OR (b.blocker_id=hp.user_id AND b.blocked_id=?)))) count,
          EXISTS(SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=? AND vhf.tag=hf.tag) viewerFollowing
          FROM hashtag_follows hf
          WHERE hf.user_id=?
          ORDER BY hf.tag`,
        ).all(viewerId, viewerId, viewerId, viewerId, profile.id) as { tag: string; count: number;
          viewerFollowing: boolean }[]
        : []
      return page(
        <Connections user={user} profile={profile} people={people} tags={tags} kind={tab} page={profilePage}
          total={connectionTotal} noteCount={total} {...counts} following={following}
          blockedPeopleCount={blockCounts.blockedPeople} blockedTagCount={blockCounts.blockedTags} social={social} />,
      )
    }
    const cursorValue = c.req.query('cursor')
    const cursor = decodePostCursor(cursorValue)
    if (cursorValue && !cursor) return c.text('Invalid cursor', 400)
    const cursorFilter = cursor ? `AND p.id ${cursor.direction === 'previous' ? '>' : '<'} ?` : ''
    const rows = db.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?)) ${cursorFilter}
      ORDER BY p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`)
      .all(profile.id, viewerId, viewerId, ...(cursor ? [cursor.id] : []), PAGE_SIZE + 1) as PostView[]
    const result = postCursorPage(rows, cursor)
    const posts = enrichPosts(db, result.rows, viewerId)
    return page(
      <Profile user={user} profile={profile} posts={blocked || blockedByProfile ? [] : posts} following={following}
        blocked={blocked} total={total} followerCount={counts.followerCount} followingCount={counts.followingCount}
        followingTagCount={counts.followingTagCount} blockedPeopleCount={blockCounts.blockedPeople}
        blockedTagCount={blockCounts.blockedTags} social={social} previousCursor={result.previousCursor}
        nextCursor={result.nextCursor} />,
    )
  })
}
