import type { Database } from 'bun:sqlite'
import { isDevelopment } from './environment'

export const POST_LIMIT = 5
export const POST_WINDOW_SECONDS = 5 * 60
export const DUPLICATE_POST_WINDOW_SECONDS = 15

export type PostInsert = { id: number; duplicate: boolean } | { retryAfter: number }

export function insertRateLimitedPost(
  database: Database,
  userId: number,
  body: string,
  parentId: number | null = null,
  afterInsert?: (postId: number) => void,
  pendingKey?: string | null,
): PostInsert {
  return database.transaction(() => {
    const supportsPendingKey = !!pendingKey && !!database.query(
      'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'pending_key\'',
    ).get()
    const pendingDuplicate = supportsPendingKey
      ? database.query('SELECT id FROM posts WHERE pending_key=?')
        .get(pendingKey) as { id: number } | null
      : null
    if (pendingDuplicate) return { id: pendingDuplicate.id, duplicate: true }
    const duplicate = database.query(`
      SELECT id FROM posts
      WHERE user_id=? AND parent_id IS ? AND body=? AND deleted_at IS NULL
        AND created_at >= datetime('now', '-' || ? || ' seconds')
      ORDER BY id DESC LIMIT 1
    `).get(userId, parentId, body, DUPLICATE_POST_WINDOW_SECONDS) as { id: number } | null

    if (duplicate) return { id: duplicate.id, duplicate: true }

    const limited = isDevelopment() ? null : database.query(`
      SELECT MAX(1, ? - (unixepoch('now') - unixepoch(MIN(created_at)))) AS retry_after
      FROM (
        SELECT created_at FROM posts
        WHERE user_id=? AND created_at > datetime('now', '-' || ? || ' seconds')
        ORDER BY created_at DESC LIMIT ?
      )
      HAVING count(*) >= ?
    `).get(POST_WINDOW_SECONDS, userId, POST_WINDOW_SECONDS, POST_LIMIT, POST_LIMIT) as
      | { retry_after: number }
      | null

    if (limited) return { retryAfter: limited.retry_after }

    const inserted = (supportsPendingKey
      ? database.query('INSERT INTO posts(user_id,parent_id,body,pending_key) VALUES(?,?,?,?) RETURNING id')
        .get(userId, parentId, body, pendingKey)
      : database.query('INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?) RETURNING id')
        .get(userId, parentId, body)) as { id: number }
    afterInsert?.(inserted.id)
    return { id: inserted.id, duplicate: false }
  })()
}

export function postRateLimitMessage(retryAfter: number) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60))
  return `You can post up to ${POST_LIMIT} times every 5 minutes. Try again in about ${minutes} ${
    minutes === 1 ? 'minute' : 'minutes'
  }.`
}
