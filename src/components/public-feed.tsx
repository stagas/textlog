import { db, type User } from '../db'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, pageSize, Pagination } from './page-shared'
import { Post } from './post'

export function PublicFeed(
  { page, user = null, path = '/' }: { page: number; user?: User | null; path?: string },
) {
  const viewerId = user?.id ?? -1
  const total = (db.query(`SELECT count(*) AS count FROM posts p WHERE deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
    .get(viewerId, viewerId, viewerId) as { count: number }).count
  const posts = enrichPosts(db, db.query(
    `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).all(viewerId, viewerId, viewerId, pageSize, (page - 1) * pageSize) as PostView[], viewerId)
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined}>
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={path} />
    </Layout>
  )
}
