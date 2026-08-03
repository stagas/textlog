import { db, type User } from '../db'
import { getHotPosts } from '../hot'
import { enrichPosts } from '../posts'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, pageSize, Pagination } from './page-shared'
import { Post } from './post'

export function HotFeed({ page, user, title }: { page: number; user: User | null; title?: string }) {
  const viewerId = user?.id ?? -1
  const total = (db.query(`SELECT count(*) AS count FROM posts p WHERE deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
      OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
    .get(viewerId, viewerId, viewerId) as { count: number }).count
  const posts = enrichPosts(db, getHotPosts(db, pageSize, (page - 1) * pageSize, new Date(), viewerId), viewerId)
  return (
    <Layout user={user} title={title}>
      <h1 className="visually-hidden">Hot notes</h1>
      <FeedTabs active="hot" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path="/hot" />
    </Layout>
  )
}
