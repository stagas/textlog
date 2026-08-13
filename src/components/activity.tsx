import { type ActivityCursor, activityTimestamp, encodeActivityCursor } from '../activity-order'
import { hasUnreadActivity, markActivityEntriesRead } from '../activity-state'
import { isAdmin } from '../admin'
import { db, type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { fmt, fmtFull, linkify } from '../utils'
import { Layout } from './layout'
import { ActionPair, CursorPagination, FeedTabs } from './page-shared'
import { Post } from './post'

const activityPostWhere = `p.deleted_at IS NULL AND
  (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id != ?)) AND
  NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)) AND
  NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=p.id AND bh.user_id=?)`

export function Activity({ user, cursor, title, path = '/activity', pageUrl, notificationBanner = false }: {
  user: User
  cursor: ActivityCursor | null
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: boolean
}) {
  const hasUnread = hasUnreadActivity(user.id)
  const comparison = cursor?.direction === 'previous' ? '>' : '<'
  const cursorFilter = cursor
    ? `WHERE (${activityTimestamp} ${comparison} ? OR
        (${activityTimestamp}=? AND activity.activity_key ${comparison} ?))`
    : ''
  const direction = cursor?.direction === 'previous' ? 'ASC' : 'DESC'
  const posts = db.query(
    `SELECT activity.*,${activityTimestamp} activity_timestamp,ar.event_key IS NULL unread FROM (
      SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,u.handle,
        CASE WHEN parent.user_id=? THEN 'reply' ELSE 'mention' END activity_kind,
        NULL bio,NULL posts,NULL viewerFollowing,'post:' || p.id activity_key
        FROM posts p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN posts parent ON parent.id=p.parent_id
        LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
        WHERE ${activityPostWhere}
        GROUP BY p.id
      UNION ALL
      SELECT NULL id,f.follower_id user_id,NULL parent_id,NULL body,f.created_at,NULL deleted_at,
        u.handle,'follow' activity_kind,u.bio,
        (SELECT count(*) FROM posts fp WHERE fp.user_id=u.id AND fp.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing,
        'follow:' || f.follower_id || ':' || f.created_at activity_key
        FROM follows f JOIN users u ON u.id=f.follower_id
        WHERE f.following_id=? AND f.created_at IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
            OR (b.blocker_id=f.follower_id AND b.blocked_id=?))
      UNION ALL
      SELECT NULL id,u.id user_id,NULL parent_id,NULL body,u.handle_chosen_at created_at,NULL deleted_at,
        u.handle,'signup' activity_kind,u.bio,
        (SELECT count(*) FROM posts sp WHERE sp.user_id=u.id AND sp.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing,
        'signup:' || u.id || ':' || u.handle_chosen_at activity_key
        FROM users u WHERE ?=1 AND u.handle_chosen_at IS NOT NULL
          AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      ) activity LEFT JOIN activity_reads ar ON ar.user_id=? AND ar.event_key=activity.activity_key
      ${cursorFilter} ORDER BY activity_timestamp ${direction},activity.activity_key ${direction} LIMIT ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id,
    Number(isAdmin(user)), user.id, ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.key] : []),
    PAGE_SIZE + 1) as (PostView & {
      activity_kind: 'reply' | 'mention' | 'follow' | 'signup'
      posts: number | null
      viewerFollowing: boolean | null
      bio: string | null
      activity_key: string
      activity_timestamp: number
      unread: number
    })[]
  const ordered = cursor?.direction === 'previous' ? [...posts].reverse() : posts
  const hasMore = ordered.length > PAGE_SIZE
  const activityPage = cursor?.direction === 'previous' && hasMore ? ordered.slice(1) : ordered.slice(0, PAGE_SIZE)
  const returnPath = path + (cursor ? `?cursor=${encodeURIComponent(encodeActivityCursor(cursor))}` : '')
  const canGoBack = Boolean(cursor) && (cursor!.direction === 'next' || hasMore)
  const canGoNext = cursor?.direction === 'previous' || hasMore
  const previousCursor = canGoBack && activityPage.length
    ? encodeActivityCursor({ timestamp: activityPage[0].activity_timestamp, key: activityPage[0].activity_key,
      direction: 'previous' })
    : null
  const nextCursor = canGoNext && activityPage.length
    ? encodeActivityCursor({ timestamp: activityPage.at(-1)!.activity_timestamp, key: activityPage.at(-1)!.activity_key,
      direction: 'next' })
    : null
  markActivityEntriesRead(user.id, activityPage.filter(post => post.unread).map(post => post.activity_key))
  const activity = enrichPosts(db, activityPage.filter(post =>
    post.activity_kind === 'reply'
    || post.activity_kind === 'mention'
  ), user.id)
  const activityById = new Map(activity.map(post => [post.id, post]))
  const hasNotes = activityPage.length > 0 || !!db.query(
    'SELECT 1 FROM posts WHERE user_id=? AND deleted_at IS NULL LIMIT 1',
  ).get(user.id)
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}>
      <h1 className="visually-hidden">activity</h1>
      <FeedTabs active="activity" user={user} activityReadStatus={activityPage.length ? hasUnread : undefined} />
      {activityPage.length
        ? activityPage.map((rawPost, index) => {
          const post = rawPost.activity_kind === 'reply' || rawPost.activity_kind === 'mention'
            ? activityById.get(rawPost.id)!
            : rawPost
          return (
            <div className={`activity-item${rawPost.unread ? ' activity-item-unread' : ''}`}
              key={rawPost.activity_kind === 'reply' || rawPost.activity_kind === 'mention'
                ? rawPost.id
                : `${rawPost.activity_kind}-${rawPost.user_id}-${index}`}
            >
              {rawPost.activity_kind === 'signup'
                ? (
                  <article className="activity-follow">
                    <div className="activity-follow-content">
                      <div className="activity-follow-main">
                        {!!rawPost.unread && <span className="unread-dot" aria-label="unread" />}
                        <a href={`/admin/users/${rawPost.user_id}`}>@{rawPost.handle}</a>
                        <span>signed up:</span>
                        <time dateTime={rawPost.created_at} title={fmtFull(rawPost.created_at)}>
                          {fmt(rawPost.created_at)}
                        </time>
                        <span aria-hidden="true">·</span>
                        <small>{rawPost.posts} {rawPost.posts === 1 ? 'note' : 'notes'}</small>
                      </div>
                      <p className="profile-bio" dangerouslySetInnerHTML={{
                        __html: linkify(rawPost.bio || 'No bio yet.'),
                      }} />
                    </div>
                    {rawPost.user_id !== user.id && (
                      <form method="post" action={'/follow/' + rawPost.handle}>
                        <button className={`button${rawPost.viewerFollowing ? ' button-muted' : ''}`}>
                          {rawPost.viewerFollowing ? 'unfollow' : 'follow'}
                        </button>
                      </form>
                    )}
                  </article>
                )
                : rawPost.activity_kind === 'follow'
                ? (
                  <article className="activity-follow">
                    <div className="activity-follow-content">
                      <div className="activity-follow-main">
                        {!!rawPost.unread && <span className="unread-dot" aria-label="unread" />}
                        <a href={'/u/' + rawPost.handle}>@{rawPost.handle}</a>
                        <span>followed you:</span>
                        <time dateTime={rawPost.created_at} title={fmtFull(rawPost.created_at)}>
                          {fmt(rawPost.created_at)}
                        </time>
                        <span aria-hidden="true">·</span>
                        <small>{rawPost.posts} {rawPost.posts === 1 ? 'note' : 'notes'}</small>
                      </div>
                      <p className="profile-bio" dangerouslySetInnerHTML={{
                        __html: linkify(rawPost.bio || 'No bio yet.'),
                      }} />
                    </div>
                    <form method="post" action={'/follow/' + rawPost.handle}>
                      <button className={`button${rawPost.viewerFollowing ? ' button-muted' : ''}`}>
                        {rawPost.viewerFollowing ? 'unfollow' : 'follow'}
                      </button>
                    </form>
                  </article>
                )
                : (
                  <Post p={post} user={user} showReplyCount tappable returnPath={`${returnPath}#post-${post.id}`}
                    contextLabel={rawPost.activity_kind === 'reply' ? 'replied:' : 'mentioned you:'}
                    contextUnread={!!rawPost.unread} />
                )}
            </div>
          )
        })
        : !cursor
        ? (
          <div className="empty empty-actions">
            <p>
              When someone replies to or mentions you, or starts following you, it’ll show up here.
              {isAdmin(user) && ' You’ll also see new signups.'}
            </p>
            <ActionPair
              primary={<a className="button" href="/latest">browse latest notes</a>}
              secondary={
                <>
                  <a href="/explore">explore</a>
                  <span className="action-separator">or</span>
                  <a href="/write">{hasNotes ? 'write a note' : 'write your first note'}</a>
                </>
              }
            />
          </div>
        )
        : (
          <div className="empty">
            No activity on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <CursorPagination path={path} previousCursor={previousCursor} nextCursor={nextCursor} />
    </Layout>
  )
}
