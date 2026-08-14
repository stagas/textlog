import type { Database } from 'bun:sqlite'
import { extractHashtags, extractMentions } from './content'
import { encodeHotCursor, getHotPosts, type HotCursor, hotCursor } from './hot'
import { searchExpression } from './search'

export const API_DEFAULT_LIMIT = 20
export const API_MAX_LIMIT = 100

type ApiPostRow = {
  id: number
  body: string
  parent_id: number | null
  created_at: string
  handle: string
  reply_count: number
}

export type ApiPost = {
  id: number
  body: string
  created_at: string
  parent_id: number | null
  reply_count: number
  tags: string[]
  mentions: string[]
  url: string
  api_url: string
  author: { handle: string; url: string; api_url: string }
}

export function apiOrigin(requestUrl: string, appUrl: string | null | undefined = Bun.env.APP_URL) {
  return appUrl?.replace(/\/$/, '') || new URL(requestUrl).origin
}

export function isoTimestamp(value: string) {
  return new Date(value.replace(' ', 'T') + 'Z').toISOString()
}

export function encodeCursor(id: number) {
  return btoa(String(id)).replace(/=+$/, '')
}

export function parseCollectionParams(limitValue?: string, cursorValue?: string) {
  let limit = API_DEFAULT_LIMIT
  if (limitValue !== undefined) {
    limit = Number(limitValue)
    if (!Number.isInteger(limit) || limit < 1 || limit > API_MAX_LIMIT) return null
  }
  let before: number | null = null
  if (cursorValue !== undefined) {
    try {
      const decoded = atob(cursorValue.replace(/-/g, '+').replace(/_/g, '/'))
      before = Number(decoded)
      if (!Number.isInteger(before) || before < 1 || encodeCursor(before) !== cursorValue) return null
    }
    catch {
      return null
    }
  }
  return { limit, before }
}

export function serializePost(row: ApiPostRow, origin: string): ApiPost {
  const handle = row.handle.toLowerCase()
  return {
    id: row.id,
    body: row.body,
    created_at: isoTimestamp(row.created_at),
    parent_id: row.parent_id,
    reply_count: row.reply_count,
    tags: extractHashtags(row.body),
    mentions: extractMentions(row.body),
    url: `${origin}/post/${row.id}`,
    api_url: `${origin}/api/v1/posts/${row.id}`,
    author: {
      handle,
      url: `${origin}/u/${encodeURIComponent(handle)}`,
      api_url: `${origin}/api/v1/users/${encodeURIComponent(handle)}`,
    },
  }
}

const postSelect = `SELECT p.id,p.body,p.parent_id,p.created_at,u.handle,
  0 reply_count
  FROM posts p JOIN users u ON u.id=p.user_id`

function withReplyCounts<T extends Omit<ApiPostRow, 'reply_count'>>(
  database: Database,
  rows: T[],
): Array<T & { reply_count: number }> {
  if (!rows.length) return []
  const placeholders = rows.map(() => '?').join(',')
  const counts = database.query(`WITH RECURSIVE descendants(root_id,id,user_id,deleted_at) AS (
    SELECT id,id,user_id,deleted_at FROM posts WHERE id IN (${placeholders})
    UNION ALL
    SELECT descendants.root_id,p.id,p.user_id,p.deleted_at FROM posts p
      JOIN descendants ON p.parent_id=descendants.id
  ) SELECT descendants.root_id,count(*) reply_count FROM descendants
    JOIN users u ON u.id=descendants.user_id
    WHERE descendants.id!=descendants.root_id AND descendants.deleted_at IS NULL AND u.deleted_at IS NULL
    GROUP BY descendants.root_id`).all(...rows.map(row => row.id)) as { root_id: number; reply_count: number }[]
  const countById = new Map(counts.map(row => [row.root_id, row.reply_count]))
  return rows.map(row => ({ ...row, reply_count: countById.get(row.id) || 0 }))
}

export function apiPost(database: Database, id: number, origin: string) {
  const row = database.query(`${postSelect} WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`)
    .get(id) as ApiPostRow | null
  return row ? serializePost(withReplyCounts(database, [row])[0], origin) : null
}

export function apiPosts(database: Database, origin: string, options: {
  limit: number
  before: number | null
  handle?: string
  parentId?: number
  tag?: string
  excludeBots?: boolean
}) {
  const filters = ['p.deleted_at IS NULL', 'u.deleted_at IS NULL']
  const parameters: Array<string | number> = []
  if (options.excludeBots) filters.push('u.is_bot = 0')
  if (options.before !== null) {
    filters.push('p.id < ?')
    parameters.push(options.before)
  }
  if (options.handle !== undefined) {
    filters.push('u.handle = ? COLLATE NOCASE')
    parameters.push(options.handle)
  }
  if (options.parentId !== undefined) {
    filters.push('p.parent_id = ?')
    parameters.push(options.parentId)
  }
  if (options.tag !== undefined) {
    filters.push('EXISTS (SELECT 1 FROM post_hashtags ph WHERE ph.post_id=p.id AND ph.tag=?)')
    parameters.push(options.tag)
  }
  const rows = database.query(`${postSelect} WHERE ${filters.join(' AND ')}
    ORDER BY p.id DESC LIMIT ?`).all(...parameters, options.limit + 1) as ApiPostRow[]
  const hasMore = rows.length > options.limit
  const pageRows = withReplyCounts(database, rows.slice(0, options.limit))
  return {
    data: pageRows.map(row => serializePost(row, origin)),
    pagination: { next_cursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1].id) : null },
  }
}

export function apiHotPosts(database: Database, origin: string, limit: number, cursor: HotCursor | null) {
  const asOf = cursor?.asOf || new Date().toISOString()
  const rows = getHotPosts(database, limit + 1, cursor, asOf, -1, true)
  const hasMore = rows.length > limit
  const selected = rows.slice(0, limit)
  const pageRows = withReplyCounts(database, selected)
  return {
    data: pageRows.map(row => serializePost(row, origin)),
    pagination: { next_cursor: hasMore ? encodeHotCursor(hotCursor(rows[limit - 1], asOf)) : null },
  }
}

export function apiSearchPosts(database: Database, origin: string, query: string, limit: number, offset = 0) {
  const expression = searchExpression(query)
  const rows = database.query(`${postSelect} JOIN post_search ON post_search.rowid=p.id
    WHERE post_search MATCH ? AND p.deleted_at IS NULL AND u.deleted_at IS NULL
    ORDER BY bm25(post_search),p.id DESC LIMIT ? OFFSET ?`)
    .all(expression, limit + 1, offset) as ApiPostRow[]
  const hasMore = rows.length > limit
  const pageRows = withReplyCounts(database, rows.slice(0, limit))
  return {
    data: pageRows.map(row => serializePost(row, origin)),
    pagination: { next_cursor: hasMore ? encodeCursor(offset + limit) : null },
  }
}
