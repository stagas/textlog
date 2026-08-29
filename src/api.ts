import type { Database } from 'bun:sqlite'
import { extractHashtags, extractMentions } from './content'
import { encodeHotCursor, getHotPosts, type HotCursor, hotCursor } from './hot'
import { getImageUrl, isImageKey } from './image-storage'
import { decodeHtmlEntities } from './link-preview'
import { LOCATION_MAP_STYLE_VERSION, LOCATION_ZOOM, osmLocationUrl } from './locations'
import { loadPolls } from './polls'
import { searchExpression } from './search'
import type { ApiPost, LinkPreview } from './types'
import { excludesWhisperPosts } from './whisper'
export type { ApiPost } from './types'

export const API_DEFAULT_LIMIT = 20
export const API_MAX_LIMIT = 100
export const API_DEFAULT_REPLY_DEPTH = 1
export const API_MAX_REPLY_DEPTH = 20

type ApiPostRow = {
  id: number
  top_id: number | null
  body: string
  translation?: string | null
  execution_output?: string | null
  parent_id: number | null
  created_at: string
  handle: string
  reply_count: number
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
    top_id: row.top_id,
    body: row.body,
    ...(row.translation ? { translation: row.translation } : {}),
    ...(row.execution_output !== undefined ? { execution_output: row.execution_output } : {}),
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

const postSelect = `SELECT p.*,p.id top_id,u.handle,
  0 reply_count
  FROM posts p JOIN users u ON u.id=p.user_id`

function withReplyCounts<T extends Omit<ApiPostRow, 'reply_count' | 'top_id'>>(
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

function withTopIds<T extends Omit<ApiPostRow, 'top_id'>>(
  database: Database,
  rows: T[],
): Array<T & { top_id: number | null }> {
  if (!rows.length) return []
  const placeholders = rows.map(() => '?').join(',')
  const roots = database.query(`WITH RECURSIVE ancestors(root_id,id,parent_id) AS (
    SELECT id,id,parent_id FROM posts WHERE id IN (${placeholders})
    UNION ALL
    SELECT ancestors.root_id,p.id,p.parent_id FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
  ) SELECT root_id,id top_id FROM ancestors WHERE parent_id IS NULL`)
    .all(...rows.map(row => row.id)) as Array<{ root_id: number; top_id: number }>
  const topIdByPost = new Map(roots.map(row => [row.root_id, row.top_id]))
  return rows.map(row => {
    const topId = topIdByPost.get(row.id) || row.id
    return { ...row, top_id: topId === row.id ? null : topId }
  })
}

function enrichApiRows<T extends Omit<ApiPostRow, 'reply_count' | 'top_id'>>(database: Database, rows: T[]) {
  return withTopIds(database, withReplyCounts(database, rows))
}

function apiExtras(database: Database, postIds: number[], viewerId: number) {
  const previews = new Map<number, Record<string, LinkPreview>>()
  const locations = new Map<number, NonNullable<ApiPost['location']>>()
  if (postIds.length && database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
  ).get()) {
    const mimeTypeColumn = database.query(
        'SELECT 1 FROM pragma_table_info(\'post_link_previews\') WHERE name=\'mime_type\'',
      ).get()
      ? 'mime_type'
      : 'NULL AS mime_type'
    const rows = database.query(`SELECT post_id,url,image_url,title,description,site_name,image_width,image_height,
      ${mimeTypeColumn}
      FROM post_link_previews WHERE post_id IN (${postIds.map(() => '?').join(',')})`).all(...postIds) as Array<{
      post_id: number
      url: string
      image_url: string
      title: string | null
      description: string | null
      site_name: string | null
      image_width: number | null
      image_height: number | null
      mime_type: string | null
    }>
    for (const row of rows) {
      const values = previews.get(row.post_id) || {}
      values[row.url] = { imageUrl: isImageKey(row.image_url) ? getImageUrl(row.image_url) : row.image_url,
        title: row.title ? decodeHtmlEntities(row.title) : undefined,
        description: row.description ? decodeHtmlEntities(row.description) : undefined,
        siteName: row.site_name ? decodeHtmlEntities(row.site_name) : undefined,
        imageWidth: row.image_width || undefined, imageHeight: row.image_height || undefined,
        mimeType: row.mime_type || undefined }
      previews.set(row.post_id, values)
    }
  }
  if (postIds.length && database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_locations'",
  ).get()) {
    const rows = database.query(`SELECT l.post_id,l.query,l.latitude,l.longitude,l.display_name,
      m.image_key,m.width,m.height FROM post_locations l JOIN location_map_previews m ON m.cache_key=
      printf('${LOCATION_ZOOM}:${LOCATION_MAP_STYLE_VERSION}:%.6f:%.6f',l.latitude,l.longitude) WHERE l.post_id IN
      (${postIds.map(() => '?').join(',')})`).all(...postIds) as Array<{ post_id: number; query: string;
      latitude: number; longitude: number; display_name: string; image_key: string; width: number; height: number }>
    for (const row of rows) {
      const metadata = { query: row.query, latitude: row.latitude, longitude: row.longitude,
        displayName: row.display_name }
      const [title, ...description] = row.display_name.split(',').map(part => part.trim()).filter(Boolean)
      locations.set(row.post_id, { ...metadata, url: osmLocationUrl(metadata), preview: {
        imageUrl: getImageUrl(row.image_key), title: title || row.query,
        description: description.join(', ') || row.display_name, imageWidth: row.width, imageHeight: row.height,
      } })
    }
  }
  return { previews, locations, polls: loadPolls(database, postIds, viewerId) }
}

function withApiExtras(post: ApiPost, extras: ReturnType<typeof apiExtras>, id: number): ApiPost {
  const poll = extras.polls.get(id)
  const reveal = !!poll && (poll.expired || poll.viewerVoted)
  return { ...post, link_previews: extras.previews.get(id) || {}, location: extras.locations.get(id) || null,
    poll: poll
    ? {
      options: poll.options.map(option => ({ id: option.id, label: option.label, votes: reveal ? option.votes : null,
        selected: option.selected, ...(poll.kind === 'quiz' ? { correct: reveal ? !!option.correct : null } : {}) })
      ),
      kind: poll.kind || 'poll',
      ...(poll.kind === 'quiz' ? { explanation: reveal ? poll.explanation || null : null } : {}),
      total_votes: reveal ? poll.totalVotes : null,
      expired: poll.expired,
      expires_at: poll.expiresAt === null ? null : new Date(poll.expiresAt).toISOString(),
      viewer_voted: poll.viewerVoted,
    }
    : null }
}

function serializePostsWithParents(database: Database, rows: ApiPostRow[], origin: string, viewerId = -1): ApiPost[] {
  const parentIds = [...new Set(rows.flatMap(row => row.parent_id === null ? [] : [row.parent_id]))]
  let parentsById = new Map<number, ApiPost>()
  if (parentIds.length) {
    const placeholders = parentIds.map(() => '?').join(',')
    const visibility = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)`
    const parentRows = database.query(`${postSelect} WHERE p.id IN (${placeholders})
      AND p.deleted_at IS NULL AND u.deleted_at IS NULL ${visibility}`)
      .all(...parentIds, ...(viewerId < 0 ? [] : [viewerId, viewerId, viewerId])) as ApiPostRow[]
    const enrichedParents = enrichApiRows(database, parentRows)
    const parentExtras = apiExtras(database, enrichedParents.map(row => row.id), viewerId)
    const parents = enrichedParents.map(row => withApiExtras(serializePost(row, origin), parentExtras, row.id))
    parentsById = new Map(parents.map(parent => [parent.id, parent]))
  }
  const extras = apiExtras(database, rows.map(row => row.id), viewerId)
  return rows.map(row => ({ ...withApiExtras(serializePost(row, origin), extras, row.id),
    parent: row.parent_id === null ? null : parentsById.get(row.parent_id) || null })
  )
}

export function apiPostsByIds(database: Database, origin: string, ids: number[], viewerId = -1) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const visibility = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const rows = database.query(`${postSelect} WHERE p.id IN (${placeholders})
    AND p.deleted_at IS NULL AND u.deleted_at IS NULL ${visibility}`)
    .all(...ids, ...(viewerId < 0 ? [] : [viewerId, viewerId, viewerId])) as ApiPostRow[]
  const serialized = serializePostsWithParents(database, enrichApiRows(database, rows), origin, viewerId)
  const byId = new Map(serialized.map(post => [post.id, post]))
  return ids.flatMap(id => {
    const post = byId.get(id)
    return post ? [post] : []
  })
}

export function apiPost(database: Database, id: number, origin: string, viewerId = -1) {
  const visibility = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const row = database.query(`${postSelect} WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL
    ${visibility}`).get(id, ...(viewerId < 0 ? [] : [viewerId, viewerId, viewerId])) as ApiPostRow | null
  return row ? serializePostsWithParents(database, enrichApiRows(database, [row]), origin, viewerId)[0] : null
}

export function apiPosts(database: Database, origin: string, options: {
  limit: number
  before: number | null
  handle?: string
  parentId?: number
  tag?: string
  repliesOnly?: boolean
  topLevelOnly?: boolean
  viewerId?: number
  excludeWhispers?: boolean
}) {
  const filters = ['p.deleted_at IS NULL', 'u.deleted_at IS NULL']
  const parameters: Array<string | number> = []
  if ((options.viewerId ?? -1) >= 0) {
    filters.push(`NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    parameters.push(options.viewerId!, options.viewerId!)
    filters.push(`NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`)
    parameters.push(options.viewerId!)
  }
  if (options.repliesOnly) filters.push('p.parent_id IS NOT NULL')
  if (options.topLevelOnly) filters.push('p.parent_id IS NULL')
  if (options.excludeWhispers) filters.push(excludesWhisperPosts())
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
  const pageRows = enrichApiRows(database, rows.slice(0, options.limit))
  return {
    data: serializePostsWithParents(database, pageRows, origin, options.viewerId ?? -1),
    pagination: { next_cursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1].id) : null },
  }
}

export function apiReplies(database: Database, origin: string, parentId: number, options: {
  limit: number
  before: number | null
  depth: number
  viewerId?: number
}) {
  const beforeFilter = options.before === null ? '' : 'AND thread.id < ?'
  const parameters = options.before === null
    ? [parentId, options.depth + 1, options.depth, options.limit + 1]
    : [parentId, options.depth + 1, options.depth, options.before, options.limit + 1]
  const rows = database.query(`WITH RECURSIVE thread(id,body,parent_id,created_at,handle,depth) AS (
    SELECT p.id,p.body,p.parent_id,p.created_at,u.handle,1
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.parent_id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL
    UNION ALL
    SELECT p.id,p.body,p.parent_id,p.created_at,u.handle,thread.depth+1
    FROM posts p JOIN users u ON u.id=p.user_id JOIN thread ON p.parent_id=thread.id
    WHERE thread.depth < ? AND p.deleted_at IS NULL AND u.deleted_at IS NULL
  ) SELECT id,id top_id,body,parent_id,created_at,handle,0 reply_count,depth
    FROM thread WHERE depth <= ? ${beforeFilter}
    ORDER BY id DESC LIMIT ?`).all(...parameters) as Array<ApiPostRow & { depth: number }>
  const hasMore = rows.length > options.limit
  const selected = rows.slice(0, options.limit)
  const pageRows = enrichApiRows(database, selected)
  return {
    data: serializePostsWithParents(database, pageRows, origin, options.viewerId ?? -1)
      .map((post, index) => ({ ...post, depth: pageRows[index].depth })),
    pagination: { next_cursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1].id) : null },
  }
}

export function apiHotPosts(database: Database, origin: string, limit: number, cursor: HotCursor | null,
  viewerId = -1)
{
  const asOf = cursor?.asOf || new Date().toISOString()
  // Keep machine-readable hot feeds on the same eligibility threshold as the web hot projection. The web UI
  // groups these ranked posts by conversation, while JSON/RSS/Atom retain post-based cursor pagination.
  const rows = getHotPosts(database, limit + 1, cursor, asOf, viewerId, true, 2)
  const hasMore = rows.length > limit
  const selected = rows.slice(0, limit)
  const pageRows = enrichApiRows(database, selected)
  return {
    data: serializePostsWithParents(database, pageRows, origin, viewerId),
    pagination: { next_cursor: hasMore ? encodeHotCursor(hotCursor(rows[limit - 1], asOf)) : null },
  }
}

export function apiSearchPosts(database: Database, origin: string, query: string, limit: number, offset = 0,
  viewerId = -1)
{
  const expression = searchExpression(query)
  const visibility = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const visibilityParameters = viewerId < 0 ? [] : [viewerId, viewerId, viewerId]
  const rows = database.query(`${postSelect} JOIN post_search ON post_search.rowid=p.id
    WHERE post_search MATCH ? AND p.deleted_at IS NULL AND u.deleted_at IS NULL
    ${visibility} ORDER BY bm25(post_search),p.id DESC LIMIT ? OFFSET ?`)
    .all(expression, ...visibilityParameters, limit + 1, offset) as ApiPostRow[]
  const hasMore = rows.length > limit
  const pageRows = enrichApiRows(database, rows.slice(0, limit))
  return {
    data: serializePostsWithParents(database, pageRows, origin, viewerId),
    pagination: { next_cursor: hasMore ? encodeCursor(offset + limit) : null },
  }
}
