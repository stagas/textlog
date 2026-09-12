import type { HotCursor } from '../hot'
import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { FeedTabs } from './page-shared'
import { PublicFeedFrame } from './public-feed-frame'

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
  return <PublicFeedFrame feed={feed} user={user} path={path} title={title} pageUrl={pageUrl}
    notificationBanner={notificationBanner} feeds={{ title: 'Hot notes', rss: '/hot.rss', atom: '/hot.atom' }}
    expandedRootId={expandedRootId} writeError={writeError} writeBody={writeBody} writePreview={writePreview}
    writePreviewExecutionOutput={writePreviewExecutionOutput} writePreviewLocation={writePreviewLocation}
    writeDraftId={writeDraftId} chunk={chunk} initialChunks={initialChunks} fetchedThread={fetchedThread}
    emptyReturnHref="/hot" threadOptions={() => ({ expandedByDefault: !user && path === '/hot', promoteAncestors: true })}
    renderHeader={normalizedFeed => (
      <>
        <h1 className="visually-hidden">Hot notes</h1>
        <FeedTabs active="hot" user={user} forYouCount={normalizedFeed.forYouCount}
          forYouUnread={normalizedFeed.forYouUnread} toMeCount={normalizedFeed.toMeCount}
          toMeUnread={normalizedFeed.toMeUnread} latestCount={normalizedFeed.latestCount}
          newCount={normalizedFeed.newCount} />
      </>
    )} />
}
