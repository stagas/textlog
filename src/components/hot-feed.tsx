import { db, type User } from '../db'
import { encodeHotCursor, getHotPosts, hotCursor, type HotCursor } from '../hot'
import { enrichPosts } from '../posts'
import { Layout } from './layout'
import { FeedTabs, GlobalFeedEmpty, pageSize } from './page-shared'
import { Post } from './post'

export function HotFeed({ cursor, user, title, path = '/hot' }: { cursor: HotCursor | null; user: User | null;
  title?: string; path?: string }) {
  const viewerId = user?.id ?? -1
  const asOf = cursor?.asOf || new Date().toISOString()
  const ranked = getHotPosts(db, pageSize + 1, cursor, asOf, viewerId)
  const hasMore = ranked.length > pageSize
  const pageRows = ranked.slice(0, pageSize)
  const posts = enrichPosts(db, pageRows, viewerId)
  const nextCursor = hasMore ? encodeHotCursor(hotCursor(pageRows[pageRows.length - 1], asOf)) : null
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
      {nextCursor && (
        <nav className="pagination" aria-label="Pagination">
          <a className="pagination-edge" href={`${path}?cursor=${encodeURIComponent(nextCursor)}`}>next →</a>
        </nav>
      )}
    </Layout>
  )
}
