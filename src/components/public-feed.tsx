import { db, type User } from '../db'
import { encodePostCursor, PAGE_SIZE, type PostCursor, postCursorPage } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { Layout } from './layout'
import { CursorPagination, FeedTabs, GlobalFeedEmpty } from './page-shared'
import { Post } from './post'

export function PublicFeed(
  { cursor, user = null, path = '/', pageUrl, notificationBanner = false }: { cursor: PostCursor | null;
    user?: User | null; path?: string; pageUrl?: string; notificationBanner?: boolean },
) {
  const viewerId = user?.id ?? -1
  const cursorFilter = cursor ? `AND p.id ${cursor.direction === 'previous' ? '>' : '<'} ?` : ''
  const parameters: number[] = [viewerId, viewerId, viewerId, viewerId, viewerId]
  if (cursor) parameters.push(cursor.id)
  parameters.push(PAGE_SIZE + 1)
  const rows = db.query(
    `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?))
      ${cursorFilter} ORDER BY p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`,
  ).all(...parameters) as PostView[]
  const result = postCursorPage(rows, cursor)
  const posts = enrichPosts(db, result.rows, viewerId)
  const returnPath = path + (cursor ? `?cursor=${encodeURIComponent(encodePostCursor(cursor))}` : '')
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined} pageUrl={pageUrl}
      notificationBanner={notificationBanner}
      feeds={{ title: 'Latest notes', rss: '/latest.rss', atom: '/latest.atom' }}
    >
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount tappable
          returnPath={`${returnPath}#post-${post.id}`} />)
        : !cursor
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <CursorPagination path={path} previousCursor={result.previousCursor} nextCursor={result.nextCursor} />
    </Layout>
  )
}
