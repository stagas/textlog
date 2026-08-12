import { db, type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { fmt, fmtFull } from '../utils'
import { Layout } from './layout'
import { ActionPair, CursorPagination, FeedTabs } from './page-shared'
import { Post } from './post'
import { hasUnreadForYou, markForYouEntriesRead } from '../for-you-state'

export type ForYouCursor = { createdAt: string; key: string; direction: 'next' | 'previous' }

export function decodeForYouCursor(value?: string): ForYouCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 1
      || typeof decoded[1] !== 'string' || !decoded[1] || typeof decoded[2] !== 'string' || !decoded[2]
      || !['next', 'previous'].includes(decoded[3])) return null
    return { createdAt: decoded[1], key: decoded[2], direction: decoded[3] }
  }
  catch {
    return null
  }
}

function encodeForYouCursor(cursor: ForYouCursor) {
  return Buffer.from(JSON.stringify([1, cursor.createdAt, cursor.key, cursor.direction])).toString('base64url')
}

type TimelineRow = PostView & {
  activity_kind: 'post' | 'user_follow' | 'tag_follow'
  event_key: string
  actor_id: number
  actor_handle: string
  actor_bio: string
  target_handle: string | null
  target_tag: string | null
  target_bio: string | null
  following: boolean
  target_is_viewer: boolean
  unread: number
}

export function Feed({ user, cursor, title, path = '/for-you', pageUrl, notificationBanner = false }: {
  user: User
  cursor: ForYouCursor | null
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: boolean
}) {
  const hasUnread = hasUnreadForYou(user.id)
  const comparison = cursor?.direction === 'previous' ? '>' : '<'
  const cursorFilter = cursor
    ? `WHERE (timeline.created_at ${comparison} $cursorCreated OR
        (timeline.created_at=$cursorCreated AND timeline.event_key ${comparison} $cursorKey))`
    : ''
  const direction = cursor?.direction === 'previous' ? 'ASC' : 'DESC'
  const rows = db.query(`SELECT timeline.*,
    NOT EXISTS(SELECT 1 FROM for_you_reads fyr WHERE fyr.user_id=$viewer AND fyr.event_key=timeline.event_key) unread
    FROM (
    SELECT p.id,p.user_id,p.body,p.created_at,p.parent_id,p.deleted_at,p.has_latex,p.has_links,p.has_code,u.handle,
      EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=p.user_id) following,
      'post' activity_kind,'post:' || printf('%020d',p.id) event_key,p.user_id actor_id,
      u.handle actor_handle,u.bio actor_bio,NULL target_handle,NULL target_tag,NULL target_bio,0 target_is_viewer
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.deleted_at IS NULL AND p.user_id!=$viewer AND (p.user_id IN
        (SELECT following_id FROM follows WHERE follower_id=$viewer) OR p.id IN
        (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
          WHERE hf.user_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
          (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
          WHERE tph.post_id=p.id AND bh.user_id=$viewer)
    UNION ALL
    SELECT NULL id,actor.id user_id,NULL body,f.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,NULL has_links,
      NULL has_code,actor.handle,
      EXISTS(SELECT 1 FROM follows target_follow WHERE target_follow.follower_id=$viewer
        AND target_follow.following_id=target.id) following,'user_follow' activity_kind,
      'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',target.id) || ':' || f.created_at event_key,
      actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,target.handle target_handle,NULL target_tag,
      target.bio target_bio,
      target.id=$viewer target_is_viewer
      FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
      WHERE f.created_at IS NOT NULL AND actor.id!=$viewer AND EXISTS
        (SELECT 1 FROM follows viewer_follow WHERE viewer_follow.follower_id=$viewer
          AND viewer_follow.following_id=actor.id)
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND target.deleted_at IS NULL AND target.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          b.blocker_id=$viewer AND b.blocked_id IN (actor.id,target.id) OR
          b.blocked_id=$viewer AND b.blocker_id IN (actor.id,target.id))
    UNION ALL
    SELECT NULL id,actor.id user_id,NULL body,hf.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,NULL has_links,
      NULL has_code,actor.handle,
      EXISTS(SELECT 1 FROM hashtag_follows viewer_tag WHERE viewer_tag.user_id=$viewer
        AND viewer_tag.tag=hf.tag) following,
      'tag_follow' activity_kind,
      'tag-follow:' || printf('%020d',actor.id) || ':' || hf.tag || ':' || hf.created_at event_key,
      actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,NULL target_handle,hf.tag target_tag,NULL target_bio,
      0 target_is_viewer
      FROM hashtag_follows hf JOIN users actor ON actor.id=hf.user_id
      WHERE hf.created_at IS NOT NULL AND actor.id!=$viewer AND (EXISTS
        (SELECT 1 FROM follows viewer_follow WHERE viewer_follow.follower_id=$viewer
          AND viewer_follow.following_id=actor.id) OR EXISTS
        (SELECT 1 FROM hashtag_follows viewer_tag WHERE viewer_tag.user_id=$viewer AND viewer_tag.tag=hf.tag))
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR
          (b.blocker_id=actor.id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=$viewer AND bh.tag=hf.tag)
    ) timeline ${cursorFilter}
    ORDER BY timeline.created_at ${direction},timeline.event_key ${direction} LIMIT $limit`).all({
    viewer: user.id,
    cursorCreated: cursor?.createdAt || '',
    cursorKey: cursor?.key || '',
    limit: PAGE_SIZE + 1,
  }) as TimelineRow[]
  const ordered = cursor?.direction === 'previous' ? [...rows].reverse() : rows
  const hasMore = ordered.length > PAGE_SIZE
  const timeline = cursor?.direction === 'previous' && hasMore ? ordered.slice(1) : ordered.slice(0, PAGE_SIZE)
  markForYouEntriesRead(user.id, timeline.filter(row => row.unread).map(row => row.event_key))
  const canGoBack = Boolean(cursor) && (cursor!.direction === 'next' || hasMore)
  const canGoNext = cursor?.direction === 'previous' || hasMore
  const previousCursor = canGoBack && timeline.length
    ? encodeForYouCursor({ createdAt: timeline[0].created_at, key: timeline[0].event_key, direction: 'previous' })
    : null
  const nextCursor = canGoNext && timeline.length
    ? encodeForYouCursor({ createdAt: timeline.at(-1)!.created_at, key: timeline.at(-1)!.event_key, direction: 'next' })
    : null
  const enriched = enrichPosts(db, timeline.filter(row => row.activity_kind === 'post'), user.id)
  const posts = new Map(enriched.map(post => [post.id, post]))
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user}
        forYouReadStatus={timeline.length ? hasUnread : undefined} />
      {timeline.length
        ? timeline.map(row => row.activity_kind === 'post'
          ? <div className={`for-you-item${row.unread ? ' activity-item-unread' : ''}`} key={row.event_key}>
              <Post p={posts.get(row.id)!} user={user} showReplyCount tappable contextUnread={!!row.unread} />
            </div>
          : (
            <article className={`feed-relationship${row.activity_kind === 'user_follow'
              ? ' feed-relationship-person'
              : ''}${row.unread ? ' activity-item-unread' : ''}`} key={row.event_key}>
              <div className="feed-relationship-content">
                <div className="feed-relationship-main">
                  {!!row.unread && <span className="activity-item-unread-dot" aria-label="unread" />}
                  <a href={`/u/${row.actor_handle}`} title={row.actor_bio || 'No bio yet.'}>@{row.actor_handle}</a>
                  <span>{row.target_is_viewer ? 'followed you' : 'followed'}</span>
                  {!row.target_is_viewer && row.activity_kind === 'user_follow'
                    ? <a href={`/u/${row.target_handle}`}>@{row.target_handle}</a>
                    : !row.target_is_viewer
                    ? <a href={`/tag/${row.target_tag}`}>#{row.target_tag}</a>
                    : null}
                  <span aria-hidden="true">·</span>
                  <time dateTime={row.created_at} title={fmtFull(row.created_at)}>{fmt(row.created_at)}</time>
                </div>
                {row.activity_kind === 'user_follow'
                  && <p className="profile-bio">{row.target_bio || 'No bio yet.'}</p>}
              </div>
              {!row.target_is_viewer && (
                <form method="post" action={row.activity_kind === 'user_follow'
                  ? `/follow/${row.target_handle}`
                  : `/tag-follow/${row.target_tag}`}>
                  <button className={`button${row.following ? ' unfollow-button' : ''}`}>
                    {row.following ? 'unfollow' : 'follow'}
                  </button>
                </form>
              )}
            </article>
          ))
        : !cursor
        ? (
          <div className="empty empty-actions">
            <p>Your timeline is empty. Follow people or hashtags to shape it.</p>
            <ActionPair
              primary={<a className="button" href="/explore">explore tags &amp; people</a>}
              secondary={<><a href="/">browse notes</a><span className="action-separator">or</span>
                <a href="/write">write your first note</a></>}
            />
          </div>
        )
        : <div className="empty">No activity on this page. <a href="/for-you">Return to the first page</a>.</div>}
      <CursorPagination path={path} previousCursor={previousCursor} nextCursor={nextCursor} />
    </Layout>
  )
}
