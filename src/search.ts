import type { Database } from 'bun:sqlite'
import { PAGE_SIZE } from './pagination'
import type { PostView } from './types'

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

const visibilityFilter = `p.deleted_at IS NULL AND u.deleted_at IS NULL
  AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
  AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=p.id AND bh.user_id=?))`

function visibilityParameters(viewerId: number) {
  return [viewerId, viewerId, viewerId, viewerId, viewerId]
}

export function searchPosts(database: Database, query: string, viewerId = -1, page = 1) {
  const expression = searchExpression(query)
  if (!expression) return { rows: [] as PostView[], total: 0 }
  const visible = visibilityParameters(viewerId)
  const total = (database.query(`SELECT count(*) count FROM post_search
    JOIN posts p ON p.id=post_search.rowid JOIN users u ON u.id=p.user_id
    WHERE post_search MATCH ? AND ${visibilityFilter}`)
    .get(expression, ...visible) as { count: number }).count
  const rows = database.query(`SELECT p.*,u.handle FROM post_search
    JOIN posts p ON p.id=post_search.rowid JOIN users u ON u.id=p.user_id
    WHERE post_search MATCH ? AND ${visibilityFilter}
    ORDER BY bm25(post_search),p.id DESC LIMIT ? OFFSET ?`)
    .all(expression, ...visible, PAGE_SIZE, (page - 1) * PAGE_SIZE) as PostView[]
  return { rows, total }
}
