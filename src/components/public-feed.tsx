import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { AboutContent } from './about'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { FeedThreads } from './post'

export function PublicFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user = null, path = '/', pageUrl,
    notificationBanner = false, expandedRootId }: {
      feed?: PostFeedPage
      cursor?: unknown
      user?: User | null
      path?: string
      pageUrl?: string
      notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
      expandedRootId?: number
    },
) {
  const feedPath = path
  const returnPath = feedPath + (feed.page > 1 ? `?page=${feed.page}` : '')
  const unreadPostIds = new Set(feed.unreadPostIds || [])
  const directedUnreadPostIds = new Set(feed.directedUnreadPostIds || [])
  const unreadPage = feed.unreadHref
    ? Number(new URL(feed.unreadHref, 'http://localhost').searchParams.get('page') || 1)
    : null
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined} pageUrl={pageUrl}
      mobileWriteAction={Boolean(user)}
      notificationBanner={notificationBanner}
      feeds={{ title: 'Latest notes', rss: '/latest.rss', atom: '/latest.atom' }}
    >
      {!user && <AboutContent user={null} embedded />}
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} forYouCount={feed.forYouCount} forYouUnread={feed.forYouUnread}
        toMeCount={feed.toMeCount} toMeUnread={feed.toMeUnread}
        latestCount={feed.latestCount}
        forYouReadStatus={user && feed.posts.length
          ? !!feed.latestUnread && unreadPage !== null && unreadPage > feed.page
          : undefined} unreadHref={feed.unreadHref}
        lastUnreadHref={feed.lastUnreadHref} readAction="/latest/read-all" />
      {feed.page > 1 && <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath}
        anchor={user ? undefined : 'feed-tabs'} top />}
      {feed.posts.length
        ? <FeedThreads posts={feed.posts} user={user} returnPath={returnPath}
            promoteAncestors expandedRootId={expandedRootId}
            contextUnreadPostIds={unreadPostIds} contextDirectedUnreadPostIds={directedUnreadPostIds} />
        : feed.page === 1
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath}
        anchor={user ? undefined : 'feed-tabs'} />
    </Layout>
  )
}
