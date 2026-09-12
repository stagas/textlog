import type { User } from '../types'
import type { PostFeedPage } from '../types'
import { FeedTabs } from './page-shared'
import { PublicFeedFrame } from './public-feed-frame'
import type { SharedFeedPageProps } from './feed-page-props'

type PublicFeedProps = SharedFeedPageProps & {
  feed?: PostFeedPage
  cursor?: unknown
  user?: User | null
}

export function PublicFeed(
  { feed = { posts: [], page: 1, totalItems: 0, totalPages: 1 }, user = null, path = '/', pageUrl,
    notificationBanner = false, expandedRootId, writeError, writeBody, writePreview, writePreviewExecutionOutput,
    writePreviewLocation, writeDraftId, chunk = 0, initialChunks = 1, fetchedThread }: PublicFeedProps,
) {
  const random = path.startsWith('/any')
  const newest = path === '/new'
  return <PublicFeedFrame feed={feed} user={user} path={path}
    title={path === '/all' ? 'all' : random ? 'any' : newest ? 'new' : undefined} pageUrl={pageUrl}
    notificationBanner={notificationBanner} feeds={random ? undefined : newest
      ? { title: 'New conversations', rss: '/new.rss', atom: '/new.atom' }
      : { title: 'All notes', rss: '/all.rss', atom: '/all.atom' }}
    expandedRootId={expandedRootId} writeError={writeError} writeBody={writeBody} writePreview={writePreview}
    writePreviewExecutionOutput={writePreviewExecutionOutput} writePreviewLocation={writePreviewLocation}
    writeDraftId={writeDraftId} chunk={chunk} initialChunks={initialChunks} fetchedThread={fetchedThread}
    emptyReturnHref={path} threadOptions={normalizedFeed => ({
      promoteAncestors: true,
      expandedByDefault: !user && (path === '/all' || random),
      collapseWithoutPreviews: newest,
      contextUnreadPostIds: new Set(normalizedFeed.unreadPostIds || []),
      contextDirectedUnreadPostIds: new Set(normalizedFeed.directedUnreadPostIds || []),
    })} renderHeader={normalizedFeed => {
      const unreadPage = normalizedFeed.unreadHref
        ? Number(new URL(normalizedFeed.unreadHref, 'http://localhost').searchParams.get('page') || 1)
        : null
      return <>
        {user && (
          <span hidden data-live-counts={`${normalizedFeed.toMeCount || 0}:${normalizedFeed.forYouCount || 0}:${
            normalizedFeed.latestCount || 0}:${normalizedFeed.newCount || 0}`} />
        )}
        <h1 className="visually-hidden">{random ? 'Any conversation' : newest ? 'New notes' : 'All notes'}</h1>
        <FeedTabs active={random ? 'random' : newest ? 'new' : 'latest'} user={user}
          forYouCount={normalizedFeed.forYouCount} forYouUnread={normalizedFeed.forYouUnread}
          toMeCount={normalizedFeed.toMeCount} toMeUnread={normalizedFeed.toMeUnread}
          latestCount={normalizedFeed.latestCount} newCount={normalizedFeed.newCount}
          forYouReadStatus={user && normalizedFeed.posts.length
          ? !!normalizedFeed.latestUnread && unreadPage !== null && unreadPage > normalizedFeed.page
          : undefined} unreadHref={normalizedFeed.unreadHref} lastUnreadHref={normalizedFeed.lastUnreadHref}
          readAction="/all/read-all" />
      </>
    }} />
}
