import {
  Connections,
  Profile,
} from '../components/pages'
import { moderateText, moderationMessage } from '../moderation'
import type { PostView, ProfileRow } from '../types'
import { currentPage, form, page, paginationRedirect, redirect } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { renderProfileOg } from '../og'
import { enrichPosts } from '../posts'
import { currentUser } from '../utils'

export function registerProfilesRoutes(app: Hono) {
  app.get('/u/:handle/og.png', c => {
    const profile = db.query(
      `SELECT u.handle,u.bio,
      (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) notes,
      (SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following,
      (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) followingTags,
      (SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers
      FROM users u WHERE u.handle=? AND u.deleted_at IS NULL`,
    ).get(c.req.param('handle')) as {
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
        'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  })

  app.get('/u/:handle/:kind', c => {
    const kind = c.req.param('kind')
    if (kind !== 'following' && kind !== 'followers') return c.text('Not found', 404)
    const pageQuery = c.req.query('page') ? `&page=${encodeURIComponent(c.req.query('page')!)}` : ''
    return redirect(`/u/${c.req.param('handle')}?tab=${kind}${pageQuery}`)
  })

  app.get('/u/:handle', c => {
    const user = currentUser(c.req.raw)
    const profilePage = currentPage(c.req.query('page'))
    const profile = db.query(
      'SELECT id,handle,email,bio,suspended_at,deleted_at FROM users WHERE handle=? AND deleted_at IS NULL',
    ).get(c.req.param('handle')) as ProfileRow | null
    if (!profile) return c.text('Not found', 404)
    const tab = c.req.query('tab')
    if (tab && tab !== 'following' && tab !== 'followers') return c.text('Not found', 404)
    const posts = enrichPosts(db, db.query(
      'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 20 OFFSET ?',
    ).all(profile.id, (profilePage - 1) * 20) as PostView[], user?.id ?? -1)
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
    const configuredOrigin = Bun.env.APP_URL?.replace(/\/$/, '')
    const origin = configuredOrigin || new URL(c.req.url).origin
    const profileUrl = `${origin}/u/${profile.handle}`
    const description = profile.bio.replace(/\s+/g, ' ').trim() || `@${profile.handle} on root.mx`
    const social = {
      description,
      image: `${profileUrl}/og.png`,
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
    if (!tab) {
      const outOfRange = paginationRedirect(profilePage, total, `/u/${profile.handle}`)
      if (outOfRange) return outOfRange
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
        ORDER BY u.handle LIMIT 20 OFFSET ?`,
      ).all(viewerId, profile.id, viewerId, viewerId, viewerId,
        (profilePage - 1) * 20) as import('../types').PersonView[]
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
          total={connectionTotal} noteCount={total} {...counts} following={following} social={social} />,
      )
    }
    return page(
      <Profile user={user} profile={profile} posts={blocked || blockedByProfile ? [] : posts} following={following}
        blocked={blocked} editing={user?.id === profile.id && c.req.query('edit') === '1'} page={profilePage}
        total={total} followerCount={counts.followerCount} followingCount={counts.followingCount}
        followingTagCount={counts.followingTagCount} social={social} />,
    )
  })

  app.post('/u/:handle/profile', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    if (user.handle !== c.req.param('handle')) return c.text('Forbidden', 403)
    const f = await form(c.req.raw)
    // Preserve whitespace because spaces and line breaks can be meaningful in ASCII art.
    // Treat an entirely blank submission as an empty bio, though.
    const submittedBio = f.bio || ''
    const bio = submittedBio.trim() ? submittedBio : ''
    const handle = (f.handle || '').toLowerCase().replace(/^@/, '')
    const posts = enrichPosts(db, db.query(
      'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND p.deleted_at IS NULL ORDER BY p.created_at DESC',
    ).all(user.id) as PostView[], user.id)
    if (!/^[a-z0-9_]{2,24}$/.test(handle) || bio.length > 160) {
      return page(
        <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle} editing
          error="Use a 2–24 character username and a bio up to 160 characters." />,
        400,
      )
    }
    if (handle || bio) {
      const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
      if (!moderation.ok) {
        return page(
          <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle} editing
            error={moderationMessage(moderation.reason)} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
    }
    try {
      db.query('UPDATE users SET handle=?,bio=? WHERE id=?').run(handle, bio, user.id)
    }
    catch {
      return page(
        <Profile user={user} profile={user} posts={posts} following={false} bio={bio} editHandle={handle} editing
          error="That username is unavailable." />,
        400,
      )
    }
    return redirect('/u/' + handle)
  })
}
