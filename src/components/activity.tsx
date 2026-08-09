import { markActivityEntriesRead } from '../activity-state'
import { activityOrderBy } from '../activity-order'
import { db, type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { fmt, fmtFull } from '../utils'
import { Layout } from './layout'
import { ActionPair, Pagination } from './page-shared'
import { Post } from './post'

const activityPostWhere = `p.deleted_at IS NULL AND
  (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id != ?)) AND
  NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)) AND
  NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=p.id AND bh.user_id=?)`

export function activityTotal(userId: number) {
  const postTotal = (db.query(
    `SELECT count(DISTINCT p.id) count FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE ${activityPostWhere}`,
  ).get(userId, userId, userId, userId, userId, userId) as { count: number }).count
  const followTotal = (db.query(
    `SELECT count(*) count FROM follows f WHERE following_id=? AND created_at IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
        OR (b.blocker_id=f.follower_id AND b.blocked_id=?))`,
  ).get(userId, userId, userId) as { count: number }).count
  return postTotal + followTotal
}

export function Activity({ user, page }: { user: User; page: number }) {
  const total = activityTotal(user.id)
  const posts = db.query(
    `SELECT activity.*,ar.event_key IS NULL unread FROM (
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
      ) activity LEFT JOIN activity_reads ar ON ar.user_id=? AND ar.event_key=activity.activity_key
      ORDER BY ${activityOrderBy} LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE) as (PostView & { activity_kind: 'reply' | 'mention' | 'follow'; posts: number | null;
      viewerFollowing: boolean | null; bio: string | null; activity_key: string; unread: number })[]
  markActivityEntriesRead(user.id, posts.filter(post => post.unread).map(post => post.activity_key))
  const activity = enrichPosts(db, posts.filter(post => post.activity_kind !== 'follow'), user.id)
  const activityById = new Map(activity.map(post => [post.id, post]))
  return (
    <Layout user={user} title="activity">
      <section className="page-header activity-header">
        <h1>activity</h1>
      </section>
      {posts.length
        ? posts.map((rawPost, index) => {
          const post = rawPost.activity_kind === 'follow' ? rawPost : activityById.get(rawPost.id)!
          return (
            <div className={`activity-item${rawPost.unread ? ' activity-item-unread' : ''}`}
              key={rawPost.activity_kind === 'follow' ? `follow-${rawPost.user_id}-${index}` : rawPost.id}
            >
              {rawPost.activity_kind === 'follow'
                ? (
                  <article className="activity-follow">
                    <div className="activity-follow-content">
                      <div className="activity-follow-main">
                        {!!rawPost.unread && <span className="activity-item-unread-dot" aria-label="unread" />}
                        <a href={'/u/' + rawPost.handle}>@{rawPost.handle}</a>
                        <span>followed you:</span>
                      <time dateTime={rawPost.created_at} title={fmtFull(rawPost.created_at)}>
                        {fmt(rawPost.created_at)}
                      </time>
                      <span aria-hidden="true">·</span>
                      <small>{rawPost.posts} {rawPost.posts === 1 ? 'note' : 'notes'}</small>
                      </div>
                      <p className="profile-bio">{rawPost.bio || 'No bio yet.'}</p>
                    </div>
                    <form method="post" action={'/follow/' + rawPost.handle}>
                      <button className={`button${rawPost.viewerFollowing ? ' unfollow-button' : ''}`}>
                        {rawPost.viewerFollowing ? 'unfollow' : 'follow'}
                      </button>
                    </form>
                  </article>
                )
                : (
                  <Post p={post} user={user} showReplyCount tappable
                    contextLabel={rawPost.activity_kind === 'reply' ? 'replied:' : 'mentioned you:'}
                    contextUnread={!!rawPost.unread}
                  />
                )}
            </div>
          )
        })
        : total === 0
        ? (
          <div className="empty empty-actions">
            <p>No activity yet.</p>
            <ActionPair
              primary={<a className="button" href="/">browse notes</a>}
              secondary={<a href="/write">write a note</a>}
            />
          </div>
        )
        : (
          <div className="empty">
            No activity on this page. <a href="/activity">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path="/activity" />
    </Layout>
  )
}
