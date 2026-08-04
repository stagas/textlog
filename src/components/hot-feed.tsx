import { db, type User } from '../db'
import { encodeHotCursor, getHotPosts, type HotCursor, hotCursor } from '../hot'
import { PAGE_SIZE } from '../pagination'
import { enrichPosts } from '../posts'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty } from './page-shared'
import { Post } from './post'

export function HotFeed(
  { cursor, user, title, path = '/hot' }: { cursor: HotCursor | null; user: User | null; title?: string;
    path?: string },
) {
  const viewerId = user?.id ?? -1
  const asOf = cursor?.asOf || new Date().toISOString()
  const ranked = getHotPosts(db, PAGE_SIZE + 1, cursor, asOf, viewerId)
  const hasMore = ranked.length > PAGE_SIZE
  const pageRows = cursor?.direction === 'previous' && hasMore
    ? ranked.slice(1)
    : ranked.slice(0, PAGE_SIZE)
  const posts = enrichPosts(db, pageRows, viewerId)
  const canGoBack = Boolean(cursor) && (cursor!.direction === 'next' || hasMore)
  const canGoNext = cursor?.direction === 'previous' || hasMore
  const previousCursor = canGoBack && pageRows.length
    ? encodeHotCursor(hotCursor(pageRows[0], asOf, 'previous'))
    : null
  const nextCursor = canGoNext && pageRows.length
    ? encodeHotCursor(hotCursor(pageRows[pageRows.length - 1], asOf, 'next'))
    : null
  return (
    <Layout user={user} title={title}>
      <h1 className="visually-hidden">Hot notes</h1>
      <FeedTabs active="hot" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : !cursor
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      {(previousCursor || nextCursor) && (
        <nav className="pagination hot-pagination" aria-label="Pagination">
          {previousCursor && (
            <a className="pagination-edge" href={`${path}?cursor=${encodeURIComponent(previousCursor)}`}>← back</a>
          )}
          {nextCursor && (
            <a className="pagination-edge hot-pagination-next"
              href={`${path}?cursor=${encodeURIComponent(nextCursor)}`}
            >
              next →
            </a>
          )}
        </nav>
      )}
    </Layout>
  )
}
