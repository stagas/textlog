import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { Post } from './post'

export function PublicFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user = null, path = '/', pageUrl,
    notificationBanner = false }: {
    feed?: PostFeedPage
    cursor?: unknown
    user?: User | null
    path?: string
    pageUrl?: string
    notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'notification-update' | 'donate'
  },
) {
  const returnPath = path + (feed.page > 1 ? `?page=${feed.page}` : '')
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined} pageUrl={pageUrl}
      notificationBanner={notificationBanner}
      feeds={{ title: 'Latest notes', rss: '/latest.rss', atom: '/latest.atom' }}
    >
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} forYouUnread={feed.forYouUnread} toMeUnread={feed.toMeUnread} />
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
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={feed.page} totalPages={feed.totalPages} path={path} />
    </Layout>
  )
}
