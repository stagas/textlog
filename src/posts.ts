import type { Database } from 'bun:sqlite'
import { extractHashtags, extractMentions } from './content'
import { insertRateLimitedPost } from './post-rate-limit'
import type { ParentPost, PostView } from './types'
import { publishPost } from './api-broker'
import { resolveHandle } from './handles'
import { recordHotActivity } from './hot'

export function syncPostMetadata(database: Database, postId: number, body: string) {
  database.query('DELETE FROM post_hashtags WHERE post_id=?').run(postId)
  database.query('DELETE FROM post_mentions WHERE post_id=?').run(postId)
  const insertTag = database.query('INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES(?,?)')
  const insertMention = database.query('INSERT OR IGNORE INTO post_mentions(post_id,user_id) VALUES(?,?)')

  for (const tag of extractHashtags(body)) insertTag.run(postId, tag)
  for (const handle of extractMentions(body)) {
    const mentioned = resolveHandle(database, handle)
    if (mentioned) insertMention.run(postId, mentioned.id)
  }
}

export function createPost(
  database: Database,
  userId: number,
  body: string,
  parentId: number | null = null,
) {
  const result = insertRateLimitedPost(database, userId, body, parentId,
    postId => {
      syncPostMetadata(database, postId, body)
      recordHotActivity(database, postId)
    })
  if ('id' in result) publishPost(result.id)
  return result
}

export function updatePost(database: Database, postId: number, body: string) {
  database.transaction(() => {
    database.query('UPDATE posts SET body=? WHERE id=?').run(body, postId)
    syncPostMetadata(database, postId, body)
  })()
}

export function enrichPosts(database: Database, posts: PostView[], viewerId = -1) {
  if (!posts.length) return posts
  const ids = posts.map(post => post.id)
  const parentIds = [...new Set(posts.flatMap(post => post.parent_id ? [post.parent_id] : []))]
  const placeholders = ids.map(() => '?').join(',')
  const visibleReply = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=posts.user_id) OR (b.blocker_id=posts.user_id AND b.blocked_id=?))`
  const countParameters = viewerId < 0 ? ids : [...ids, viewerId, viewerId]
  const counts = database.query(
    `SELECT parent_id,count(*) reply_count FROM posts
      WHERE deleted_at IS NULL AND parent_id IN (${placeholders}) ${visibleReply} GROUP BY parent_id`,
  ).all(...countParameters) as { parent_id: number; reply_count: number }[]
  const countById = new Map(counts.map(row => [row.parent_id, row.reply_count]))

  let parents = new Map<number, ParentPost>()
  if (parentIds.length) {
    const parentPlaceholders = parentIds.map(() => '?').join(',')
    const parentReplyFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=r.user_id) OR (b.blocker_id=r.user_id AND b.blocked_id=?))`
    const parentFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`
    const parentParameters = viewerId < 0
      ? parentIds
      : [viewerId, viewerId, ...parentIds, viewerId, viewerId]
    const rows = database.query(
      `SELECT p.id,p.body,p.created_at,p.deleted_at,u.handle,
        (SELECT count(*) FROM posts r WHERE r.parent_id=p.id AND r.deleted_at IS NULL ${parentReplyFilter}) reply_count
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (${parentPlaceholders}) ${parentFilter}`,
    ).all(...parentParameters) as ParentPost[]
    parents = new Map(rows.map(parent => [parent.id, parent]))
  }
  return posts.map(post => ({
    ...post,
    reply_count: countById.get(post.id) || 0,
    parent: post.parent_id ? parents.get(post.parent_id) || null : null,
  }))
}
