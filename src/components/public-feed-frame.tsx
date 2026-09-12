import React from 'preact/compat'
import type { PostFeedPage, User } from '../types'
import { AnonymousWriteForm, ComposePreview, WriteForm } from './compose'
import { feedChunkReturnPath, feedPostsWithFetchedThread } from './infinite-feed'
import { Layout } from './layout'
import { GlobalFeedEmpty, Pagination } from './page-shared'
import { ThreadedFeedChunks } from './threaded-feed'

type NotificationBanner = false | 'notifications' | 'appearance' | 'invite' | 'bio' | 'notification-update' | 'donate'
type ThreadOptions = Omit<React.ComponentProps<typeof ThreadedFeedChunks>,
  'posts' | 'user' | 'returnPath' | 'chunk' | 'initialChunks'>

export function PublicFeedFrame({ feed, user, path, title, pageUrl, feeds, notificationBanner = false,
  expandedRootId, writeError, writeBody, writePreview, writePreviewExecutionOutput, writePreviewLocation,
  writeDraftId, chunk = 0, initialChunks = 1, fetchedThread, renderHeader, threadOptions, emptyReturnHref }: {
    feed: PostFeedPage
    user: User | null
    path: string
    title?: string
    pageUrl?: string
    feeds?: { title: string; rss: string; atom: string }
    notificationBanner?: NotificationBanner
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
    renderHeader: (feed: PostFeedPage) => React.ReactNode
    threadOptions: (feed: PostFeedPage) => ThreadOptions
    emptyReturnHref: string
  }) {
  const normalizedFeed = { ...feed, posts: feedPostsWithFetchedThread(feed.posts, fetchedThread) }
  const renderedChunk = chunk === 0 ? initialChunks - 1 : chunk
  const pagePath = path + (normalizedFeed.page > 1 ? `${path.includes('?') ? '&' : '?'}page=${normalizedFeed.page}` : '')
  let returnPath = feedChunkReturnPath(pagePath, renderedChunk)
  if (fetchedThread?.length) {
    const target = new URL(returnPath, 'http://textlog.local')
    target.searchParams.set('fetch', String(fetchedThread[0]!.id))
    returnPath = target.pathname + target.search
  }
  const chunkMarkup = <ThreadedFeedChunks posts={normalizedFeed.posts} user={user} returnPath={returnPath}
    chunk={chunk} initialChunks={initialChunks} expandedRootId={expandedRootId} {...threadOptions(normalizedFeed)} />
  if (chunk > 0) return chunkMarkup

  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner} mobileWriteAction
      feeds={feeds}
      hasUnreadActivity={!!user && ((normalizedFeed.toMeCount || 0) > 0 || (normalizedFeed.forYouCount || 0) > 0)}
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
        {renderHeader(normalizedFeed)}
        {normalizedFeed.page > 1
          && <Pagination page={normalizedFeed.page} totalPages={normalizedFeed.totalPages} path={path} top />}
        {normalizedFeed.posts.length
          ? chunkMarkup
          : normalizedFeed.page === 1
          ? <GlobalFeedEmpty user={user} />
          : (
            <div className="empty">
              No notes on this page. <a href={emptyReturnHref}>Return to the first page</a>.
            </div>
          )}
        <Pagination page={normalizedFeed.page} totalPages={normalizedFeed.totalPages} path={path} />
      </div>
    </Layout>
  )
}
