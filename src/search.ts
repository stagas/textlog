import type { Database } from 'bun:sqlite'
import { excludesDroppedUsernameUsers } from './handles'
import { PAGE_SIZE } from './pagination'
import type { PostView } from './types'
import type { PersonView, TagView } from './types'

export const MAX_SEARCH_LENGTH = 100

export function normalizeSearchQuery(value?: string) {
  return (value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH)
}

export function searchExpression(query: string) {
  const terms = searchTerms(query)
  return terms.map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
}

export function searchTerms(query: string) {
  return query.match(/[\p{L}\p{N}_]+/gu) || []
}

const visibilityFilter = (database: Database) => `p.deleted_at IS NULL AND u.deleted_at IS NULL
  AND ${excludesDroppedUsernameUsers(database)}
  AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
  AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=p.id AND bh.user_id=?))`

function visibilityParameters(viewerId: number) {
  return [viewerId, viewerId, viewerId, viewerId, viewerId]
}

export function searchPosts(database: Database, query: string, viewerId = -1, page = 1, pageSize = PAGE_SIZE) {
  const expression = searchExpression(query)
  if (!expression) return { rows: [] as PostView[], total: 0 }
  const visible = visibilityParameters(viewerId)
  const total = (database.query(`SELECT count(*) count FROM post_search
    JOIN posts p ON p.id=post_search.rowid JOIN users u ON u.id=p.user_id
    WHERE post_search MATCH ? AND ${visibilityFilter(database)}`)
    .get(expression, ...visible) as { count: number }).count
  const rows = database.query(`SELECT p.*,u.handle FROM post_search
    JOIN posts p ON p.id=post_search.rowid JOIN users u ON u.id=p.user_id
    WHERE post_search MATCH ? AND ${visibilityFilter(database)}
    ORDER BY bm25(post_search),p.id DESC LIMIT ? OFFSET ?`)
    .all(expression, ...visible, pageSize, (page - 1) * pageSize) as PostView[]
  return { rows, total }
}

export function searchPeople(database: Database, query: string, viewerId = -1, page = 1,
  { followedFirst = false, handleOnly = false } = {})
{
  const expression = searchExpression(query)
  if (!expression) return { rows: [] as PersonView[], total: 0 }
  const matchExpression = handleOnly ? `handle : (${expression})` : expression
  const visibility = `u.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`
  const parameters = [viewerId, viewerId, viewerId]
  const total = (database.query(`SELECT count(*) count FROM user_search
    JOIN users u ON u.id=user_search.rowid WHERE user_search MATCH ? AND ${visibility}`)
    .get(matchExpression, ...parameters) as { count: number }).count
  const rows = database.query(`SELECT u.*,
    (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
    EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) viewerFollowing,
    EXISTS(SELECT 1 FROM follows rf WHERE rf.follower_id=u.id AND rf.following_id=?) followsViewer
    FROM user_search JOIN users u ON u.id=user_search.rowid
    WHERE user_search MATCH ? AND ${visibility}
    ORDER BY ${followedFirst ? 'viewerFollowing DESC,' : ''}bm25(user_search),u.handle LIMIT ? OFFSET ?`)
    .all(viewerId, viewerId, matchExpression, ...parameters, PAGE_SIZE, (page - 1) * PAGE_SIZE) as PersonView[]
  return { rows, total }
}

export function searchTags(database: Database, query: string, viewerId = -1, page = 1, { followedFirst = false } = {}) {
  const expression = searchExpression(query)
  if (!expression) return { rows: [] as TagView[], total: 0 }
  const visibility = `p.deleted_at IS NULL AND u.deleted_at IS NULL AND ${excludesDroppedUsernameUsers(database)}
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=? AND bh.tag=ph.tag))`
  const parameters = visibilityParameters(viewerId)
  const matches = `FROM tag_search JOIN post_hashtags ph ON ph.rowid=tag_search.rowid
    JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
    WHERE tag_search MATCH ? AND ${visibility}`
  const total = (database.query(`SELECT count(*) count FROM (SELECT ph.tag ${matches} GROUP BY ph.tag)`)
    .get(expression, ...parameters) as { count: number }).count
  const rows = database.query(`SELECT ph.tag,count(*) count,
    EXISTS(SELECT 1 FROM hashtag_follows hf WHERE hf.user_id=? AND hf.tag=ph.tag) viewerFollowing
    ${matches} GROUP BY ph.tag ORDER BY ${
    followedFirst ? 'viewerFollowing DESC,' : ''
  }count DESC,ph.tag LIMIT ? OFFSET ?`)
    .all(viewerId, expression, ...parameters, PAGE_SIZE, (page - 1) * PAGE_SIZE) as TagView[]
  return { rows, total }
}
