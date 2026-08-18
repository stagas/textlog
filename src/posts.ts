import type { Database } from 'bun:sqlite'
import { publishPost } from './api-broker'
import { extractHashtags, extractMentions, postContentFlags } from './content'
import { resolveHandle } from './handles'
import { recordHotActivity } from './hot'
import { insertRateLimitedPost } from './post-rate-limit'
import type { BioReferenceData, LinkPreview, ParentPost, PostView, UserProfileStats } from './types'
import { getImageUrl, isImageKey } from './image-storage'
import { decodeHtmlEntities, userBioLinkPreviews } from './link-preview'

export function loadBioReferenceData(database: Database, bio: string, profileId: number, viewerId = -1): BioReferenceData {
  const tags = extractHashtags(bio)
  const handles = extractMentions(bio)
  const hashtagCounts = visibleHashtagCounts(database, [bio], viewerId)
  const hashtagFollowerCounts = visibleTagFollowerCounts(database, tags, viewerId)
  const followedTags = viewerId < 0 || !tags.length ? new Set<string>() : new Set(
    (database.query(`SELECT tag FROM hashtag_follows WHERE user_id=? AND tag IN
      (${tags.map(() => '?').join(',')})`).all(viewerId, ...tags) as { tag: string }[]).map(row => row.tag),
  )
  const mentionBios: Record<string, string> = {}
  const mentionIds: Record<string, number> = {}
  for (const handle of handles) {
    const mentioned = resolveHandle(database, handle)
    if (!mentioned) continue
    const account = database.query('SELECT bio FROM users WHERE id=?').get(mentioned.id) as { bio: string } | null
    if (account) {
      mentionBios[handle] = account.bio
      mentionIds[handle] = mentioned.id
    }
  }
  const stats = visibleUserProfileStats(database, Object.values(mentionIds), viewerId)
  const followedIds = viewerId < 0 || !Object.keys(mentionIds).length ? new Set<number>() : new Set(
    (database.query(`SELECT following_id FROM follows WHERE follower_id=? AND following_id IN
      (${Object.keys(mentionIds).map(() => '?').join(',')})`).all(viewerId, ...Object.values(mentionIds)) as {
      following_id: number
    }[]).map(row => row.following_id),
  )
  const mentionProfileStats = Object.fromEntries(Object.entries(mentionIds)
    .flatMap(([handle, id]) => stats.has(id) ? [[handle, stats.get(id)!]] : []))
  return {
    hashtagCounts,
    hashtagFollowerCounts,
    hashtagFollowing: Object.fromEntries(tags.map(tag => [tag, followedTags.has(tag)])),
    mentionBios,
    mentionNoteCounts: Object.fromEntries(Object.entries(mentionProfileStats).map(([handle, value]) => [handle,
      value.notes])),
    mentionProfileStats,
    mentionFollowing: Object.fromEntries(Object.entries(mentionIds).map(([handle, id]) => [handle,
      followedIds.has(id)])),
    linkPreviews: userBioLinkPreviews(database, profileId),
  }
}

export function visibleHashtagCounts(database: Database, bodies: string[], viewerId = -1) {
  const tags = [...new Set(bodies.flatMap(extractHashtags))]
  if (!tags.length) return {}
  const placeholders = tags.map(() => '?').join(',')
  const viewerFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags hidden_ph JOIN blocked_hashtags bh ON bh.tag=hidden_ph.tag
      WHERE hidden_ph.post_id=p.id AND bh.user_id=?)`
  const parameters = viewerId < 0 ? tags : [...tags, viewerId, viewerId, viewerId]
  const rows = database.query(`SELECT ph.tag,count(*) count FROM post_hashtags ph
    JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
    WHERE ph.tag IN (${placeholders}) AND p.deleted_at IS NULL
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL ${viewerFilter}
    GROUP BY ph.tag`).all(...parameters) as { tag: string; count: number }[]
  const counts = new Map(rows.map(row => [row.tag, row.count]))
  return Object.fromEntries(tags.map(tag => [tag, counts.get(tag) || 0]))
}

export function visibleUserProfileStats(database: Database, userIds: number[], viewerId = -1) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return new Map<number, UserProfileStats>()
  const connectionVisibility = (connectedId: string) =>
    `AND ($viewer < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=$viewer AND b.blocked_id=${connectedId})
      OR (b.blocker_id=${connectedId} AND b.blocked_id=$viewer)))`
  const rows = database.query(`SELECT u.id,
    (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.parent_id IS NULL AND p.deleted_at IS NULL) notes,
    (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.parent_id IS NOT NULL AND p.deleted_at IS NULL) replies,
    (SELECT count(*) FROM follows f WHERE f.following_id=u.id ${connectionVisibility('f.follower_id')}) followers,
    (SELECT count(*) FROM follows f WHERE f.follower_id=u.id ${connectionVisibility('f.following_id')}) following,
    (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) followingTags
    FROM users u WHERE u.id IN (${ids.join(',')}) AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .all({ viewer: viewerId }) as ({ id: number } & UserProfileStats)[]
  const stats = new Map(rows.map(({ id, ...values }) => [id, values]))
  const empty = (): UserProfileStats => ({ notes: 0, replies: 0, followers: 0, following: 0, followingTags: 0 })
  return new Map(ids.map(id => [id, stats.get(id) || empty()]))
}

export function visibleTagFollowerCounts(database: Database, tags: string[], viewerId = -1) {
  const unique = [...new Set(tags)]
  if (!unique.length) return {} as Record<string, number>
  return Object.fromEntries((database.query(`SELECT hf.tag,count(*) count FROM hashtag_follows hf
    JOIN users u ON u.id=hf.user_id WHERE hf.tag IN (${unique.map(() => '?').join(',')})
    AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))) GROUP BY hf.tag`)
    .all(...unique, viewerId, viewerId, viewerId) as { tag: string; count: number }[]).map(row => [row.tag, row.count]))
}

export function syncPostMetadata(database: Database, postId: number, body: string) {
  const flags = postContentFlags(body)
  database.query('UPDATE posts SET has_latex=?,has_links=?,has_code=? WHERE id=?')
    .run(flags.has_latex, flags.has_links, flags.has_code, postId)
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
  publish = true,
) {
  const result = insertRateLimitedPost(database, userId, body, parentId, postId => {
    syncPostMetadata(database, postId, body)
    recordHotActivity(database, postId)
    database.query(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key)
      VALUES(?,'post:' || printf('%020d',?))`).run(userId, postId)
  })
  if (publish && 'id' in result && !result.duplicate) publishPost(result.id)
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

  const mentionedHandles = [...new Set([
    ...posts.flatMap(post => extractMentions(post.body)),
    ...authors.flatMap(author => extractMentions(author.bio)),
  ])]
  const mentionBios: Record<string, string> = {}
  const mentionUserIds: Record<string, number> = {}
  const mentionNoteCounts: Record<string, number> = {}
  const mentionProfileStats: Record<string, UserProfileStats> = {}
  const parentBodies: string[] = []
  const addMentionBio = (handle: string) => {
    if (mentionBios[handle] !== undefined) return
    const mentioned = resolveHandle(database, handle)
    if (!mentioned) return
    const account = database.query('SELECT bio FROM users WHERE id=?').get(mentioned.id) as { bio: string } | null
    if (account) {
      mentionBios[handle] = account.bio
      mentionUserIds[handle] = mentioned.id
    }
  }
  for (const handle of mentionedHandles) addMentionBio(handle)
  const parentIds = [...new Set(posts.flatMap(post => post.parent_id ? [post.parent_id] : []))]
  const previewPostIds = [...new Set([...ids, ...parentIds])]
  const previewRows = database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_link_previews'",
  ).get()
    ? database.query(`SELECT post_id,url,image_url,title,description,site_name,image_width,image_height
      FROM post_link_previews WHERE post_id IN
      (${previewPostIds.map(() => '?').join(',')})`).all(...previewPostIds) as {
        post_id: number; url: string; image_url: string; title: string | null; description: string | null;
        site_name: string | null; image_width: number | null; image_height: number | null
      }[]
    : []
  const previewsByPost = new Map<number, Record<string, LinkPreview>>()
  for (const row of previewRows) {
    const previews = previewsByPost.get(row.post_id) || {}
    previews[row.url] = { imageUrl: isImageKey(row.image_url) ? getImageUrl(row.image_url) : row.image_url,
      title: row.title ? decodeHtmlEntities(row.title) : undefined,
      description: row.description ? decodeHtmlEntities(row.description) : undefined,
      siteName: row.site_name ? decodeHtmlEntities(row.site_name) : undefined,
      imageWidth: row.image_width || undefined, imageHeight: row.image_height || undefined }
    previewsByPost.set(row.post_id, previews)
  }
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
      `SELECT p.id,p.user_id,p.body,p.created_at,p.deleted_at,p.has_latex,p.has_links,p.has_code,u.handle,u.bio,
        0 reply_count
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (${parentPlaceholders}) ${parentFilter}`,
    ).all(...parentParameters) as ParentPost[]
    for (const parent of rows) {
      parentBodies.push(parent.body)
      parent.reply_count = countById.get(parent.id) || 0
      parent.link_previews = previewsByPost.get(parent.id)
      for (const handle of extractMentions(parent.body)) addMentionBio(handle)
      for (const handle of extractMentions(parent.bio || '')) addMentionBio(handle)
    }
    parents = new Map(rows.map(parent => [parent.id, parent]))
  }
  const hashtagCounts = visibleHashtagCounts(database,
    [...posts.map(post => post.body), ...authors.map(author => author.bio), ...parentBodies,
      ...[...parents.values()].map(parent => parent.bio || '')], viewerId)
  const profileStats = visibleUserProfileStats(database, [...userIds,
    ...[...parents.values()].flatMap(parent => parent.user_id == null ? [] : [parent.user_id]),
    ...Object.values(mentionUserIds)], viewerId)
  for (const [handle, id] of Object.entries(mentionUserIds)) {
    const stats = profileStats.get(id)
    mentionNoteCounts[handle] = stats?.notes || 0
    if (stats) mentionProfileStats[handle] = stats
  }
  const relevantUserIds = [...profileStats.keys()]
  const relevantTags = Object.keys(hashtagCounts)
  const hashtagFollowerCounts = visibleTagFollowerCounts(database, relevantTags, viewerId)
  const followedUserIds = viewerId < 0 || !relevantUserIds.length
    ? new Set<number>()
    : new Set((database.query(`SELECT following_id FROM follows WHERE follower_id=? AND following_id IN
      (${relevantUserIds.map(() => '?').join(',')})`).all(viewerId, ...relevantUserIds) as {
      following_id: number
    }[]).map(row => row.following_id))
  const followedTags = viewerId < 0 || !relevantTags.length
    ? new Set<string>()
    : new Set((database.query(`SELECT tag FROM hashtag_follows WHERE user_id=? AND tag IN
      (${relevantTags.map(() => '?').join(',')})`).all(viewerId, ...relevantTags) as { tag: string }[])
      .map(row => row.tag))
  const mentionFollowing = Object.fromEntries(Object.entries(mentionUserIds)
    .map(([handle, id]) => [handle, followedUserIds.has(id)]))
  const hashtagFollowing = Object.fromEntries(Object.keys(hashtagCounts)
    .map(tag => [tag, followedTags.has(tag)]))
  const bioReference = (userId: number | undefined): BioReferenceData => ({
    hashtagCounts,
    hashtagFollowerCounts,
    hashtagFollowing,
    mentionBios,
    mentionNoteCounts,
    mentionProfileStats,
    mentionFollowing,
    linkPreviews: userId == null ? {} : userBioLinkPreviews(database, userId),
  })
  for (const parent of parents.values()) {
    parent.profile_stats = parent.user_id == null ? undefined : profileStats.get(parent.user_id)
    parent.note_count = parent.profile_stats?.notes || 0
    parent.viewer_following = parent.user_id != null && followedUserIds.has(parent.user_id)
    parent.mention_bios = mentionBios
    parent.mention_note_counts = mentionNoteCounts
    parent.mention_profile_stats = mentionProfileStats
    parent.mention_following = mentionFollowing
    parent.hashtag_counts = hashtagCounts
    parent.hashtag_follower_counts = hashtagFollowerCounts
    parent.hashtag_following = hashtagFollowing
    parent.bio_reference = bioReference(parent.user_id)
  }
  return posts.map(post => ({
    ...post,
    bio: bioByUserId.get(post.user_id) ?? post.bio ?? '',
    note_count: profileStats.get(post.user_id)?.notes || 0,
    profile_stats: profileStats.get(post.user_id),
    viewer_following: followedUserIds.has(post.user_id),
    mention_bios: mentionBios,
    mention_note_counts: mentionNoteCounts,
    mention_profile_stats: mentionProfileStats,
    mention_following: mentionFollowing,
    hashtag_counts: hashtagCounts,
    hashtag_follower_counts: hashtagFollowerCounts,
    hashtag_following: hashtagFollowing,
    bio_reference: bioReference(post.user_id),
    link_previews: previewsByPost.get(post.id),
    reply_count: countById.get(post.id) || 0,
    parent: post.parent_id ? parents.get(post.parent_id) || null : null,
  }))
}

export function loadThreadReplies(database: Database, parentId: number, viewerId = -1) {
  const rows = database.query(`WITH RECURSIVE thread AS (
      SELECT p.*,u.handle,1 depth FROM posts p JOIN users u ON u.id=p.user_id WHERE p.parent_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
      UNION ALL
      SELECT p.*,u.handle,thread.depth+1 FROM posts p JOIN users u ON u.id=p.user_id
        JOIN thread ON p.parent_id=thread.id WHERE (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
    ) SELECT id,user_id,parent_id,body,created_at,deleted_at,has_latex,has_links,has_code,handle,depth
      FROM thread ORDER BY created_at ASC,id ASC`).all(parentId, viewerId, viewerId, viewerId, viewerId, viewerId,
    viewerId, viewerId, viewerId, viewerId, viewerId) as (PostView & { depth: number })[]
  return enrichPosts(database, rows, viewerId) as Array<PostView & { depth: number }>
}
