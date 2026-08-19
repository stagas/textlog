import type { HotCursor } from '../hot'
import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { Post } from './post'

export function HotFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user, title, path = '/hot', pageUrl,
    notificationBanner = false }: {
      feed?: PostFeedPage
      cursor?: HotCursor | null
      user: User | null
      title?: string
      path?: string
      pageUrl?: string
      notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'notification-update' | 'donate'
    },
) {
  const returnPath = path + (feed.page > 1 ? `?page=${feed.page}` : '')
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}
      feeds={{ title: 'Hot notes', rss: '/hot.rss', atom: '/hot.atom' }}
    >
      <h1 className="visually-hidden">Hot notes</h1>
      <FeedTabs active="hot" user={user} forYouCount={feed.forYouCount} forYouUnread={feed.forYouUnread}
        toMeUnread={feed.toMeUnread} />
      {feed.page > 1 && <Pagination page={feed.page} totalPages={feed.totalPages} path={path} top />}
      {feed.posts.length
        ? feed.posts.map(post => (
          <Post key={post.id} p={post} user={user} showReplyCount tappable
            returnPath={`${returnPath}#post-${post.id}`} />
        ))
        : feed.page === 1
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      <Pagination page={feed.page} totalPages={feed.totalPages} path={path} />
    </Layout>
  )
}
