import type { HotCursor } from '../hot'
import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { AnonymousWriteForm, ComposePreview, WriteForm } from './compose'
import { feedChunkReturnPath, feedPostsWithFetchedThread } from './infinite-feed'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, Pagination } from './page-shared'
import { ThreadedFeedChunks } from './threaded-feed'

export function HotFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user, title, path = '/hot', pageUrl,
    notificationBanner = false, expandedRootId, writeError, writeBody, writePreview, writePreviewExecutionOutput,
    writePreviewLocation, writeDraftId, chunk = 0, initialChunks = 1, fetchedThread }: {
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
      writePreview?: boolean
      writePreviewExecutionOutput?: string | null
      writePreviewLocation?: import('../types').LocationView
      writeDraftId?: string
      chunk?: number
      initialChunks?: number
      fetchedThread?: import('../types').PostView[]
    },
) {
  feed = { ...feed, posts: feedPostsWithFetchedThread(feed.posts, fetchedThread) }
  const renderedChunk = chunk === 0 ? initialChunks - 1 : chunk
  const feedPath = path
  let returnPath = feedChunkReturnPath(feedPath + (feed.page > 1 ? `?page=${feed.page}` : ''), renderedChunk)
  if (fetchedThread?.length) {
    const target = new URL(returnPath, 'http://textlog.local')
    target.searchParams.set('fetch', String(fetchedThread[0]!.id))
    returnPath = target.pathname + target.search
  }
  const chunkMarkup = <ThreadedFeedChunks posts={feed.posts} user={user} returnPath={returnPath} chunk={chunk}
    initialChunks={initialChunks} expandedRootId={expandedRootId} expandedByDefault={!user && path === '/hot'}
    promoteAncestors />
  if (chunk > 0) return chunkMarkup
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner} mobileWriteAction
      feeds={{ title: 'Hot notes', rss: '/hot.rss', atom: '/hot.atom' }}
      hasUnreadActivity={!!user && ((feed.toMeCount || 0) > 0 || (feed.forYouCount || 0) > 0)}
    >
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
      <div data-feed-view>
        <h1 className="visually-hidden">Hot notes</h1>
        <FeedTabs active="hot" user={user} forYouCount={feed.forYouCount} forYouUnread={feed.forYouUnread}
          toMeCount={feed.toMeCount} toMeUnread={feed.toMeUnread} latestCount={feed.latestCount}
          newCount={feed.newCount} />
        {feed.page > 1 && <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} top />}
        {feed.posts.length
          ? chunkMarkup
          : feed.page === 1
          ? <GlobalFeedEmpty user={user} />
          : (
            <div className="empty">
              No notes on this page. <a href="/hot">Return to the first page</a>.
            </div>
          )}
        <Pagination page={feed.page} totalPages={feed.totalPages} path={feedPath} />
      </div>
    </Layout>
  )
}
