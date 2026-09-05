import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { AnonymousWriteForm, ComposePreview, WriteForm } from './compose'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { FeedThreads } from './post'

export function PublicFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user = null, path = '/', pageUrl,
    notificationBanner = false, expandedRootId, writeError, writeBody, writePreview, writePreviewExecutionOutput,
    writePreviewLocation, writeDraftId }: {
      feed?: PostFeedPage
      cursor?: unknown
      user?: User | null
      path?: string
      pageUrl?: string
      notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
      expandedRootId?: number
      writeError?: string
      writeBody?: string
      writePreview?: boolean
      writePreviewExecutionOutput?: string | null
      writePreviewLocation?: import('../types').LocationView
      writeDraftId?: string
    },
) {
  const feedPath = path
  const random = path.startsWith('/any')
  const newest = path === '/new'
  const returnPath = feedPath + (feed.page > 1 ? `?page=${feed.page}` : '')
  const unreadPostIds = new Set(feed.unreadPostIds || [])
  const directedUnreadPostIds = new Set(feed.directedUnreadPostIds || [])
  const unreadPage = feed.unreadHref
    ? Number(new URL(feed.unreadHref, 'http://localhost').searchParams.get('page') || 1)
    : null
  return (
    <Layout user={user} title={path === '/all' ? 'all' : random ? 'any' : newest ? 'new' : undefined} pageUrl={pageUrl}
      mobileWriteAction notificationBanner={notificationBanner} feeds={random ? undefined : newest
      ? { title: 'New conversations', rss: '/new.rss', atom: '/new.atom' }
      : { title: 'All notes', rss: '/all.rss', atom: '/all.atom' }}
    >
      <h1 className="visually-hidden">{random ? 'Any conversation' : newest ? 'New notes' : 'All notes'}</h1>
      {writePreview && (
        <ComposePreview user={user} body={writeBody || ''} executionOutput={writePreviewExecutionOutput}
          location={writePreviewLocation} />
      )}
      {user
        ? (
          <WriteForm user={user} returnPath={returnPath} embedded error={writeError} body={writeBody}
            draftId={writeDraftId} />
        )
        : <AnonymousWriteForm returnPath={returnPath} error={writeError} body={writeBody} />}
      <FeedTabs active={random ? 'random' : newest ? 'new' : 'latest'} user={user} forYouCount={feed.forYouCount}
        forYouUnread={feed.forYouUnread} toMeCount={feed.toMeCount} toMeUnread={feed.toMeUnread}
        latestCount={feed.latestCount} forYouReadStatus={user && feed.posts.length
        ? !!feed.latestUnread && unreadPage !== null && unreadPage > feed.page
        : undefined} unreadHref={feed.unreadHref} lastUnreadHref={feed.lastUnreadHref} readAction="/all/read-all" />
      {feed.page > 1 && <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} top />}
      {feed.posts.length
        ? (
          <FeedThreads posts={feed.posts} user={user} returnPath={returnPath} promoteAncestors
            expandedByDefault={!user && (path === '/all' || random)} collapseWithoutPreviews={newest}
            expandedRootId={expandedRootId} contextUnreadPostIds={unreadPostIds}
            contextDirectedUnreadPostIds={directedUnreadPostIds} />
        )
        : feed.page === 1
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} />
    </Layout>
  )
}
