import { db, type User } from '../db'
import { feedSnapshotPage } from '../feed-snapshots'
import { getHotPosts, type HotCursor, type HotPost } from '../hot'
import { enrichPosts } from '../posts'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { Post } from './post'

export function HotFeed(
  { page = 1, user, title, path = '/hot', pageUrl, notificationBanner = false }: {
    page?: number
    cursor?: HotCursor | null
    user: User | null
    title?: string
    path?: string
    pageUrl?: string
    notificationBanner?: boolean
  },
) {
  const viewerId = user?.id ?? -1
  const snapshot = feedSnapshotPage<HotPost>(db, 'hot', viewerId, page,
    () => getHotPosts(db, 1_000_000, null, new Date(), viewerId))
  const posts = enrichPosts(db, snapshot.items, viewerId)
  const returnPath = path + (snapshot.page > 1 ? `?page=${snapshot.page}` : '')
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}
      feeds={{ title: 'Hot notes', rss: '/hot.rss', atom: '/hot.atom' }}
    >
      <h1 className="visually-hidden">Hot notes</h1>
      <FeedTabs active="hot" user={user} />
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
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      <Pagination page={snapshot.page} totalPages={snapshot.totalPages} path={path} />
    </Layout>
  )
}
