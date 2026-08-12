import { db, type User } from '../db'
import { feedSnapshotPage } from '../feed-snapshots'
import { type PostCursor } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { Post } from './post'

export function PublicFeed(
  { page = 1, user = null, path = '/', pageUrl, notificationBanner = false }: {
    page?: number
    cursor?: PostCursor | null
    user?: User | null
    path?: string
    pageUrl?: string
    notificationBanner?: boolean
  },
) {
  const viewerId = user?.id ?? -1
  const parameters: number[] = [viewerId, viewerId, viewerId, viewerId, viewerId]
  const snapshot = feedSnapshotPage<PostView>(db, 'latest', viewerId, page, () =>
    db.query(
      `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?))
      ORDER BY p.id DESC`,
    ).all(...parameters) as PostView[])
  const posts = enrichPosts(db, snapshot.items, viewerId)
  const returnPath = path + (snapshot.page > 1 ? `?page=${snapshot.page}` : '')
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined} pageUrl={pageUrl}
      notificationBanner={notificationBanner}
      feeds={{ title: 'Latest notes', rss: '/latest.rss', atom: '/latest.atom' }}
    >
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} />
      {snapshot.page > 1
        && <Pagination page={snapshot.page} totalPages={snapshot.totalPages} path={path} top />}
      {posts.length
        ? posts.map(post => (
          <Post key={post.id} p={post} user={user} showReplyCount tappable
            returnPath={`${returnPath}#post-${post.id}`} />
        ))
        : snapshot.page === 1
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={snapshot.page} totalPages={snapshot.totalPages} path={path} />
    </Layout>
  )
}
