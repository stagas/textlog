import { isAdmin } from '../admin'
import { db, type User } from '../db'
import { devicePageSize } from '../device-settings'
import { feedSnapshotPage } from '../feed-snapshots'
import { hasUnreadForYou, hasUnreadToMe, markForYouEntriesRead } from '../for-you-state'
import { resolveHandle } from '../handles'
import { enrichPosts, visibleTagFollowerCounts, visibleUserProfileStats } from '../posts'
import { activeRequest } from '../theme'
import type { PostView } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { MetaRow, MetaStats } from './meta'
import { ActionPair, FeedTabs, Pagination } from './page-shared'
import { Post, TagReference, UserReference } from './post'

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

export function encodeForYouCursor(cursor: ForYouCursor) {
  return Buffer.from(JSON.stringify([1, cursor.createdAt, cursor.key, cursor.direction])).toString('base64url')
}

type TimelineRow = PostView & {
  activity_kind: 'post' | 'reply' | 'mention' | 'user_follow' | 'tag_follow' | 'signup'
  event_key: string
  actor_id: number
  actor_handle: string
  actor_bio: string
  target_handle: string | null
  target_tag: string | null
  target_bio: string | null
  following: boolean
  target_is_viewer: boolean
  targeted_to_viewer: boolean
  posts: number | null
  unread: number
}

export function Feed({ user, page = 1, title, path = '/for-you', pageUrl, notificationBanner = false, toMe = false }: {
  user: User
  page?: number
  cursor?: ForYouCursor | null
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'notification-update' | 'donate'
  toMe?: boolean
}) {
  const filters = [
    ...(toMe ? ['timeline.targeted_to_viewer=1'] : []),
  ]
  const cursorFilter = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const pageSize = devicePageSize(activeRequest(), user.id)
  const snapshot = feedSnapshotPage<TimelineRow>(db, toMe ? 'to-me' : 'for-you', user.id, page,
    () =>
      db.query(`SELECT timeline.*,
    NOT EXISTS(SELECT 1 FROM for_you_reads fyr WHERE fyr.user_id=$viewer AND fyr.event_key=timeline.event_key) unread
    FROM (
    SELECT p.id,p.user_id,p.body,p.created_at,p.parent_id,p.deleted_at,p.has_latex,p.has_links,p.has_code,u.handle,
      EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=p.user_id) following,
      'post' activity_kind,'post:' || printf('%020d',p.id) event_key,p.user_id actor_id,
      u.handle actor_handle,u.bio actor_bio,NULL target_handle,NULL target_tag,NULL target_bio,0 target_is_viewer,
      0 targeted_to_viewer,NULL posts
      FROM posts p JOIN users u ON u.id=p.user_id
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
      WHERE p.deleted_at IS NULL AND p.user_id!=$viewer AND (p.user_id IN
        (SELECT following_id FROM follows WHERE follower_id=$viewer) OR p.id IN
        (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
          WHERE hf.user_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
          (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
          WHERE tph.post_id=p.id AND bh.user_id=$viewer)
        AND parent.user_id IS NOT $viewer AND pm.user_id IS NULL
    UNION ALL
    SELECT p.id,p.user_id,p.body,p.created_at,p.parent_id,p.deleted_at,p.has_latex,p.has_links,p.has_code,u.handle,
      EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=p.user_id) following,
      CASE WHEN parent.user_id=$viewer THEN 'reply' ELSE 'mention' END activity_kind,
      'post:' || printf('%020d',p.id) event_key,p.user_id actor_id,u.handle actor_handle,u.bio actor_bio,
      NULL target_handle,NULL target_tag,NULL target_bio,0 target_is_viewer,1 targeted_to_viewer,NULL posts
      FROM posts p JOIN users u ON u.id=p.user_id
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
      WHERE p.deleted_at IS NULL AND p.user_id!=$viewer
        AND (parent.user_id=$viewer OR pm.user_id IS NOT NULL)
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
      target.bio target_bio,target.id=$viewer target_is_viewer,target.id=$viewer targeted_to_viewer,
      (SELECT count(*) FROM posts tp WHERE tp.user_id=target.id AND tp.deleted_at IS NULL) posts
      FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
      WHERE f.created_at IS NOT NULL AND actor.id!=$viewer AND EXISTS
        (SELECT 1 FROM follows viewer_follow WHERE viewer_follow.follower_id=$viewer
          AND viewer_follow.following_id=actor.id) AND target.id!=$viewer
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
      0 target_is_viewer,0 targeted_to_viewer,
      (SELECT count(*) FROM post_hashtags ph JOIN posts hp ON hp.id=ph.post_id
        WHERE ph.tag=hf.tag AND hp.deleted_at IS NULL) posts
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
    UNION ALL
    SELECT NULL id,actor.id user_id,NULL body,f.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,
      NULL has_links,NULL has_code,actor.handle,
      EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id) following,
      'user_follow' activity_kind,
      'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',$viewer) || ':' || f.created_at event_key,
      actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,NULL target_handle,NULL target_tag,
      actor.bio target_bio,1 target_is_viewer,1 targeted_to_viewer,
      (SELECT count(*) FROM posts fp WHERE fp.user_id=actor.id AND fp.deleted_at IS NULL) posts
      FROM follows f JOIN users actor ON actor.id=f.follower_id
      WHERE f.following_id=$viewer AND f.created_at IS NOT NULL
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR (b.blocker_id=actor.id AND b.blocked_id=$viewer))
    UNION ALL
    SELECT NULL id,u.id user_id,NULL body,u.handle_chosen_at created_at,NULL parent_id,NULL deleted_at,
      NULL has_latex,NULL has_links,NULL has_code,u.handle,
      EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=u.id) following,
      'signup' activity_kind,'signup:' || printf('%020d',u.id) || ':' || u.handle_chosen_at event_key,
      u.id actor_id,u.handle actor_handle,u.bio actor_bio,NULL target_handle,NULL target_tag,u.bio target_bio,
      0 target_is_viewer,0 targeted_to_viewer,
      (SELECT count(*) FROM posts sp WHERE sp.user_id=u.id AND sp.deleted_at IS NULL) posts
      FROM users u WHERE $admin=1 AND u.handle_chosen_at IS NOT NULL
        AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    ) timeline ${cursorFilter}
    ORDER BY timeline.created_at DESC,timeline.event_key DESC`).all({
        viewer: user.id,
        admin: Number(isAdmin(user)),
      }) as TimelineRow[], pageSize)
  const unreadKeys = snapshot.items.length
    ? new Set((db.query(`SELECT event_key FROM for_you_reads WHERE user_id=? AND event_key IN
      (${snapshot.items.map(() => '?').join(',')})`).all(user.id, ...snapshot.items.map(row => row.event_key)) as {
      event_key: string
    }[]).map(row => row.event_key))
    : new Set<string>()
  const timeline = snapshot.items.map(row => ({ ...row, unread: Number(!unreadKeys.has(row.event_key)) }))
  const actorProfileStats = visibleUserProfileStats(db, timeline.map(row => row.actor_id), user.id)
  const targetUsers = new Map(timeline.flatMap(row => {
    if (!row.target_handle) return []
    const resolved = resolveHandle(db, row.target_handle)
    return resolved ? [[row.target_handle, resolved.id] as const] : []
  }))
  const targetProfileStats = visibleUserProfileStats(db, [...targetUsers.values()], user.id)
  const tagFollowerCounts = visibleTagFollowerCounts(db,
    timeline.flatMap(row => row.target_tag ? [row.target_tag] : []), user.id)
  markForYouEntriesRead(user.id, timeline
    .filter(row => row.unread && (toMe || !row.targeted_to_viewer))
    .map(row => row.event_key))
  const hasUnread = toMe ? hasUnreadToMe(user.id) : hasUnreadForYou(user.id)
  const firstUnread = hasUnread
    ? db.query(`SELECT item.position,item.payload FROM feed_snapshot_items item
      LEFT JOIN for_you_reads seen ON seen.user_id=?
        AND seen.event_key=json_extract(item.payload,'$.event_key')
      WHERE item.snapshot_id=? AND seen.event_key IS NULL
        AND (? OR json_extract(item.payload,'$.targeted_to_viewer')=0)
      ORDER BY item.position LIMIT 1`).get(user.id, snapshot.snapshotId, Number(toMe)) as {
        position: number
        payload: string
      } | null
    : null
  const firstUnreadRow = firstUnread ? JSON.parse(firstUnread.payload) as TimelineRow : null
  const firstUnreadPage = firstUnread ? Math.floor(firstUnread.position / pageSize) + 1 : null
  const firstUnreadAnchor = firstUnreadRow
    ? ['post', 'reply', 'mention'].includes(firstUnreadRow.activity_kind)
      ? `post-${firstUnreadRow.id}`
      : `activity-${firstUnreadRow.event_key.replace(/[^a-z0-9_-]+/gi, '-')}`
    : null
  const unreadHref = firstUnreadPage && firstUnreadAnchor
    ? `${path}${firstUnreadPage > 1 ? `?page=${firstUnreadPage}` : ''}#${firstUnreadAnchor}`
    : undefined
  const enriched = enrichPosts(db, timeline.filter(row => ['post', 'reply', 'mention'].includes(row.activity_kind)),
    user.id)
  const posts = new Map(enriched.map(post => [post.id, post]))
  const returnPath = path + (snapshot.page > 1 ? `?page=${snapshot.page}` : '')
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user} forYouReadStatus={timeline.length ? hasUnread : undefined} toMe={toMe}
        unreadHref={unreadHref} />
      {snapshot.page > 1
        && <Pagination page={snapshot.page} totalPages={snapshot.totalPages} path={path} top />}
      {timeline.length
        ? timeline.map(row => {
          const activityAnchor = `activity-${row.event_key.replace(/[^a-z0-9_-]+/gi, '-')}`
          const activityReturnPath = `${returnPath}#${activityAnchor}`
          const fromQuery = `?from=${encodeURIComponent(activityReturnPath)}`
          return ['post', 'reply', 'mention'].includes(row.activity_kind)
            ? (
              <div className={`for-you-item${row.unread ? ' activity-item-unread' : ''}`} key={row.event_key}>
                <Post p={posts.get(row.id)!} user={user} showReplyCount tappable contextUnread={!!row.unread}
                  returnPath={`${returnPath}#post-${row.id}`} contextLabel={row.activity_kind === 'reply'
                  ? 'replied to you:'
                  : row.activity_kind === 'mention'
                  ? 'mentioned you:'
                  : undefined} />
              </div>
            )
            : (
              <article className={`activity-follow${row.unread ? ' activity-item-unread' : ''}`} key={row.event_key}
                id={activityAnchor}
              >
                <div className="activity-follow-content">
                  <MetaRow className="activity-follow-main" unread={!!row.unread}>
                    <UserReference handle={row.actor_handle} bio={row.actor_bio}
                      noteCount={actorProfileStats.get(row.actor_id)?.notes || 0}
                      stats={actorProfileStats.get(row.actor_id)} following={!!row.following} user={user}
                      href={row.activity_kind === 'signup'
                        ? `/admin/users/${row.actor_id}`
                        : `/u/${row.actor_handle}${fromQuery}`} navigationQuery={fromQuery} />
                    <span className="activity-context">
                      {row.activity_kind === 'signup'
                        ? 'signed up:'
                        : row.target_is_viewer
                        ? 'followed you:'
                        : 'followed'}
                    </span>
                    {!row.target_is_viewer && row.activity_kind === 'user_follow'
                      ? (
                        <UserReference handle={row.target_handle!} bio={row.target_bio || ''} noteCount={row.posts || 0}
                          stats={targetProfileStats.get(targetUsers.get(row.target_handle!)!)}
                          following={!!row.following} user={user} href={`/u/${row.target_handle}${fromQuery}`}
                          navigationQuery={fromQuery} />
                      )
                      : row.activity_kind === 'tag_follow'
                      ? (
                        <TagReference tag={row.target_tag!} noteCount={row.posts || 0}
                          followerCount={tagFollowerCounts[row.target_tag!] || 0} following={!!row.following}
                          user={user} href={`/tag/${encodeURIComponent(row.target_tag!)}${fromQuery}`}
                          navigationQuery={fromQuery} />
                      )
                      : null}
                    {row.posts !== null
                      ? <MetaStats createdAt={row.created_at} count={row.posts} href={(row.activity_kind === 'tag_follow'
                          ? `/tag/${row.target_tag}`
                          : `/u/${
                            row.activity_kind === 'user_follow'
                              && !row.target_is_viewer
                              ? row.target_handle
                              : row.actor_handle
                          }`) + fromQuery} />
                      : <MetaStats createdAt={row.created_at} count={null} className="activity-follow-stats" />}
                  </MetaRow>
                  {(row.activity_kind === 'user_follow' || row.activity_kind === 'signup')
                    && (
                      <p className="profile-bio" dangerouslySetInnerHTML={{
                        __html: linkify(displayBio(row.target_bio)),
                      }} />
                    )}
                </div>
                {row.actor_id !== user.id && (
                  <form method="post" action={row.target_is_viewer || row.activity_kind === 'signup'
                    ? `/follow/${row.actor_handle}`
                    : row.activity_kind === 'user_follow'
                    ? `/follow/${row.target_handle}`
                    : `/tag-follow/${row.target_tag}`}
                  >
                    <button className={`button${row.following ? ' button-muted' : ''}`}>
                      {row.following ? 'unfollow' : 'follow'}
                      {row.activity_kind === 'user_follow' && !row.target_is_viewer && ` @${row.target_handle}`}
                      {row.activity_kind === 'tag_follow' && ` #${row.target_tag}`}
                    </button>
                  </form>
                )}
              </article>
            )
        })
        : snapshot.page === 1
        ? (
          <div className="empty empty-actions">
            <p>
              {toMe
                ? 'No replies, mentions, or new followers yet.'
                : 'Your timeline is empty. Follow people or hashtags to shape it.'}
            </p>
            <ActionPair
              primary={<a className="button" href="/explore">explore tags &amp; people</a>}
              secondary={
                <>
                  <a href="/">browse notes</a>
                  <span className="action-separator">or</span>
                  <a href="/write">write your first note</a>
                </>
              }
            />
          </div>
        )
        : (
          <div className="empty">
            No activity on this page. <a href="/for-you">Return to the first page</a>.
          </div>
        )}
      <Pagination page={snapshot.page} totalPages={snapshot.totalPages} path={path} />
    </Layout>
  )
}
