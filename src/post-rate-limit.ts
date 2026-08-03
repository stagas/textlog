import type { Database } from 'bun:sqlite'

export const POST_LIMIT = 3
export const POST_WINDOW_SECONDS = 5 * 60

export type PostInsert = { id: number } | { retryAfter: number }

export function insertRateLimitedPost(
  database: Database,
  userId: number,
  body: string,
  parentId: number | null = null,
  afterInsert?: (postId: number) => void,
): PostInsert {
  return database.transaction(() => {
    const limited = database.query(`
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

    const inserted = database.query('INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?) RETURNING id')
      .get(userId, parentId, body) as { id: number }
    afterInsert?.(inserted.id)
    return inserted
  })()
}

export function postRateLimitMessage(retryAfter: number) {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60))
  return `You can post up to ${POST_LIMIT} times every 5 minutes. Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}
