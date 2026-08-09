import type { Database } from 'bun:sqlite'
import { publishPost } from './api-broker'
import { extractHashtags, extractMentions } from './content'
import { resolveHandle } from './handles'
import { recordHotActivity } from './hot'
import { insertRateLimitedPost } from './post-rate-limit'
import type { ParentPost, PostView } from './types'

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
  const result = insertRateLimitedPost(database, userId, body, parentId, postId => {
    syncPostMetadata(database, postId, body)
    recordHotActivity(database, postId)
  })
  if ('id' in result && !result.duplicate) publishPost(result.id)
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
  const userIds = [...new Set(posts.map(post => post.user_id))]
  const userPlaceholders = userIds.map(() => '?').join(',')
  const authors = database.query(`SELECT id,bio FROM users WHERE id IN (${userPlaceholders})`)
    .all(...userIds) as { id: number; bio: string }[]
  const bioByUserId = new Map(authors.map(author => [author.id, author.bio]))

  const mentionedHandles = [...new Set(posts.flatMap(post => extractMentions(post.body)))]
  const mentionBios: Record<string, string> = {}
  const addMentionBio = (handle: string) => {
    if (mentionBios[handle] !== undefined) return
    const mentioned = resolveHandle(database, handle)
    if (!mentioned) return
    const account = database.query('SELECT bio FROM users WHERE id=?').get(mentioned.id) as { bio: string } | null
    if (account) mentionBios[handle] = account.bio
  }
  for (const handle of mentionedHandles) addMentionBio(handle)
  const parentIds = [...new Set(posts.flatMap(post => post.parent_id ? [post.parent_id] : []))]
  const countRootIds = [...new Set([...ids, ...parentIds])]
  const placeholders = countRootIds.map(() => '?').join(',')
  const visibleReply = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const countParameters = viewerId < 0
    ? countRootIds
    : [...countRootIds, viewerId, viewerId, viewerId]
  const counts = database.query(
    `WITH RECURSIVE descendants(root_id,id,deleted_at) AS (
      SELECT id,id,deleted_at FROM posts WHERE id IN (${placeholders})
      UNION ALL
      SELECT descendants.root_id,p.id,p.deleted_at FROM posts p
        JOIN descendants ON p.parent_id=descendants.id WHERE 1=1 ${visibleReply}
    )
    SELECT root_id,count(*) reply_count FROM descendants
      WHERE id != root_id AND deleted_at IS NULL GROUP BY root_id`,
  ).all(...countParameters) as { root_id: number; reply_count: number }[]
  const countById = new Map(counts.map(row => [row.root_id, row.reply_count]))

  let parents = new Map<number, ParentPost>()
  if (parentIds.length) {
    const parentPlaceholders = parentIds.map(() => '?').join(',')
    const parentFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)`
    const parentParameters = viewerId < 0
      ? parentIds
      : [...parentIds, viewerId, viewerId, viewerId]
    const rows = database.query(
      `SELECT p.id,p.body,p.created_at,p.deleted_at,u.handle,u.bio,
        0 reply_count
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (${parentPlaceholders}) ${parentFilter}`,
    ).all(...parentParameters) as ParentPost[]
    for (const parent of rows) {
      parent.reply_count = countById.get(parent.id) || 0
      for (const handle of extractMentions(parent.body)) addMentionBio(handle)
      parent.mention_bios = mentionBios
    }
    parents = new Map(rows.map(parent => [parent.id, parent]))
  }
  return posts.map(post => ({
    ...post,
    bio: bioByUserId.get(post.user_id) ?? post.bio ?? '',
    mention_bios: mentionBios,
    reply_count: countById.get(post.id) || 0,
    parent: post.parent_id ? parents.get(post.parent_id) || null : null,
  }))
}
