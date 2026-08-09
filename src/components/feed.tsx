import { db, type User } from '../db'
import { PAGE_SIZE, type PostCursor, postCursorPage } from '../pagination'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { Layout } from './layout'
import { ActionPair, CursorPagination, FeedTabs } from './page-shared'
import { Post } from './post'

export function Feed({ user, cursor, title, path = '/for-you' }: {
  user: User
  cursor: PostCursor | null
  title?: string
  path?: string
}) {
  const cursorFilter = cursor ? `AND p.id ${cursor.direction === 'previous' ? '>' : '<'} ?` : ''
  const parameters = [user.id, user.id, user.id, user.id, user.id, user.id]
  if (cursor) parameters.push(cursor.id)
  parameters.push(PAGE_SIZE + 1)
  const rows = db.query(
    `SELECT p.*,u.handle, EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=p.user_id) following FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
        WHERE tph.post_id=p.id AND bh.user_id=?)
      ${cursorFilter} ORDER BY p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`,
  ).all(...parameters.slice(0, 6), user.id, ...parameters.slice(6)) as PostView[]
  const result = postCursorPage(rows, cursor)
  const posts = enrichPosts(db, result.rows, user.id)
  return (
    <Layout user={user} title={title}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user} />
      {posts.length
        ? posts.map(p => <Post key={p.id} p={p} user={user} showReplyCount tappable />)
        : !cursor
        ? (
          <div className="empty empty-actions">
            <p>Your timeline is empty. Follow people or hashtags to shape it.</p>
            <ActionPair
              primary={<a className="button" href="/explore">explore tags &amp; people</a>}
              secondary={(
                <>
                  <a href="/">browse notes</a>
                  <span className="action-separator">or</span>
                  <a href="/write">write your first note</a>
                </>
              )}
            />
          </div>
        )
        : (
          <div className="empty">
            No notes on this page. <a href="/for-you">Return to the first page</a>.
          </div>
        )}
      <CursorPagination path={path} previousCursor={result.previousCursor} nextCursor={result.nextCursor} />
    </Layout>
  )
}
