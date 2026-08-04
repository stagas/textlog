import { db, type User } from '../db'
import { markActivityEntriesRead } from '../activity-state'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { Layout } from './layout'
import { Pagination } from './page-shared'
import { Post } from './post'

const activityPostWhere = `p.deleted_at IS NULL AND
  (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id != ?)) AND
  NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`

export function activityTotal(userId: number) {
  const postTotal = (db.query(
    `SELECT count(DISTINCT p.id) count FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE ${activityPostWhere}`,
  ).get(userId, userId, userId, userId, userId) as { count: number }).count
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
      SELECT p.*,u.handle,CASE WHEN parent.user_id=? THEN 'reply' ELSE 'mention' END activity_kind,
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
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, PAGE_SIZE,
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
              <div className="activity-context">
                {rawPost.activity_kind === 'reply'
                  ? 'replied to you'
                  : rawPost.activity_kind === 'mention'
                  ? 'mentioned you'
                  : 'followed you'}
              </div>
              {rawPost.activity_kind === 'follow'
                ? (
                  <div className="post people activity-follow">
                    <article className="activity-person">
                      <div>
                        <div>
                          <a href={'/u/' + rawPost.handle}>@{rawPost.handle}</a>
                          <small>{rawPost.posts} {rawPost.posts === 1 ? 'note' : 'notes'}</small>
                        </div>
                        <form method="post" action={'/follow/' + rawPost.handle}>
                          <button className={`button${rawPost.viewerFollowing ? ' unfollow-button' : ''}`}>
                            {rawPost.viewerFollowing ? 'unfollow' : 'follow'}
                          </button>
                        </form>
                      </div>
                      <p className="profile-bio">{rawPost.bio || 'No bio yet.'}</p>
                    </article>
                  </div>
                )
                : <Post p={post} user={user} showReplyCount />}
            </div>
          )
        })
        : total === 0
        ? (
          <div className="empty empty-actions">
            <p>No activity yet.</p>
            <div>
              <a className="button" href="/latest">browse latest</a>
              <a href="/write">write a note</a>
            </div>
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
