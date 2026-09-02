import type { HotCursor } from '../hot'
import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { AboutContent } from './about'
import { WriteForm } from './compose'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { FeedThreads } from './post'

export function HotFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user, title, path = '/hot', pageUrl,
    notificationBanner = false, expandedRootId, writeError, writeBody }: {
      feed?: PostFeedPage
      cursor?: HotCursor | null
      user: User | null
      title?: string
      path?: string
      pageUrl?: string
      notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
      expandedRootId?: number
      writeError?: string
      writeBody?: string
    },
) {
  const feedPath = path
  const returnPath = feedPath + (feed.page > 1 ? `?page=${feed.page}` : '')
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}
      mobileWriteAction feeds={{ title: 'Hot notes', rss: '/hot.rss', atom: '/hot.atom' }}
    >
      {!user && <AboutContent user={null} embedded />}
      <h1 className="visually-hidden">Hot notes</h1>
      {user && <WriteForm user={user} returnPath={returnPath} embedded error={writeError} body={writeBody} />}
      <FeedTabs active="hot" user={user} forYouCount={feed.forYouCount} forYouUnread={feed.forYouUnread}
        toMeCount={feed.toMeCount} toMeUnread={feed.toMeUnread} latestCount={feed.latestCount} />
      {feed.page > 1 && (
        <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} top />
      )}
      {feed.posts.length
        ? <FeedThreads posts={feed.posts} user={user} returnPath={returnPath} expandedRootId={expandedRootId}
          expandedByDefault={!user && path === '/hot'} promoteAncestors />
        : feed.page === 1
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} />
    </Layout>
  )
}
