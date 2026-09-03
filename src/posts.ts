import type { Database } from 'bun:sqlite'
import { isAdminEmail } from './admin'
import { publishPost } from './api-broker'
import { extractAuthoredHashtags, extractHashtags, extractMentions, pascalCaseHashtagDisplayName,
  postContentFlags } from './content'
import { resolveHandle } from './handles'
import { recordHotActivity } from './hot'
import { getImageUrl, isImageKey } from './image-storage'
import { markLatestPostsRead } from './latest-state'
import { metaThreadVisibleToViewer } from './meta-thread'
import { decodeHtmlEntities, userBioLinkPreviews } from './link-preview'
import { LOCATION_MAP_STYLE_VERSION, LOCATION_ZOOM, locationMapKey, osmLocationUrl } from './locations'
import { loadPolls, syncPoll } from './polls'
import { insertRateLimitedPost } from './post-rate-limit'
import type { BioReferenceData, LinkPreview, ParentPost, PostView, UserProfileStats } from './types'
import { postReferenceIds } from './utils'

function moderatorViewer(database: Database, viewerId: number) {
  if (viewerId < 0) return false
  if (!database.query("SELECT 1 FROM pragma_table_info('users') WHERE name='email'").get()) return false
  const viewer = database.query('SELECT email FROM users WHERE id=?').get(viewerId) as { email: string } | null
  return !!viewer && isAdminEmail(viewer.email)
}

function canonicalTags(database: Database, tags: string[]) {
  const unique = [...new Set(tags)]
  const aliases = !unique.length || !database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tag_aliases'",
  ).get()
    ? []
    : database.query(`SELECT alias,primary_tag FROM tag_aliases WHERE alias IN
      (${unique.map(() => '?').join(',')})`).all(...unique) as { alias: string; primary_tag: string }[]
  const primaryByAlias = new Map(aliases.map(row => [row.alias, row.primary_tag]))
  return new Map(unique.map(tag => [tag, primaryByAlias.get(tag) || tag]))
}

export function loadBioReferenceData(database: Database, bio: string, profileId: number,
  viewerId = -1): BioReferenceData
{
  const tags = extractHashtags(bio)
  const handles = extractMentions(bio)
  const hashtagCounts = visibleHashtagCounts(database, [bio], viewerId)
  const hashtagFollowerCounts = visibleTagFollowerCounts(database, tags, viewerId)
  const canonicalByTag = canonicalTags(database, tags)
  const canonical = [...new Set(canonicalByTag.values())]
  const followedTags = viewerId < 0 || !tags.length ? new Set<string>() : new Set(
    (database.query(`SELECT tag FROM hashtag_follows WHERE user_id=? AND tag IN
      (${canonical.map(() => '?').join(',')})`).all(viewerId, ...canonical) as { tag: string }[]).map(row => row.tag),
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
  const followerIds = viewerId < 0 || !Object.keys(mentionIds).length ? new Set<number>() : new Set(
    (database.query(`SELECT follower_id FROM follows WHERE following_id=? AND follower_id IN
      (${Object.keys(mentionIds).map(() => '?').join(',')})`).all(viewerId, ...Object.values(mentionIds)) as {
      follower_id: number
    }[]).map(row => row.follower_id),
  )
  return {
    hashtagCounts,
    hashtagFollowerCounts,
    hashtagFollowing: Object.fromEntries(tags.map(tag => [tag, followedTags.has(canonicalByTag.get(tag)!)])),
    mentionBios,
    mentionNoteCounts: Object.fromEntries(
      Object.entries(mentionProfileStats).map(([handle, value]) => [handle, value.notes]),
    ),
    mentionProfileStats,
    mentionFollowing: Object.fromEntries(
      Object.entries(mentionIds).map(([handle, id]) => [handle, followedIds.has(id)]),
    ),
    mentionFollowsViewer: Object.fromEntries(
      Object.entries(mentionIds).map(([handle, id]) => [handle, followerIds.has(id)]),
    ),
    linkPreviews: userBioLinkPreviews(database, profileId),
  }
}

export function visibleHashtagCounts(database: Database, bodies: string[], viewerId = -1) {
  const tags = [...new Set(bodies.flatMap(extractHashtags))]
  if (!tags.length) return {}
  const canonicalByTag = canonicalTags(database, tags)
  const canonical = [...new Set(canonicalByTag.values())]
  const placeholders = canonical.map(() => '?').join(',')
  const viewerFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags hidden_ph JOIN blocked_hashtags bh ON bh.tag=hidden_ph.tag
      WHERE hidden_ph.post_id=p.id AND bh.user_id=?)`
  const parameters = viewerId < 0 ? canonical : [...canonical, viewerId, viewerId, viewerId]
  const rows = database.query(`SELECT ph.tag,count(*) count FROM post_hashtags ph
    JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
    WHERE ph.tag IN (${placeholders}) AND p.deleted_at IS NULL
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL ${viewerFilter}
    GROUP BY ph.tag`).all(...parameters) as { tag: string; count: number }[]
  const counts = new Map(rows.map(row => [row.tag, row.count]))
  return Object.fromEntries(tags.map(tag => [tag, counts.get(canonicalByTag.get(tag)!) || 0]))
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
  const canonicalByTag = canonicalTags(database, unique)
  const canonical = [...new Set(canonicalByTag.values())]
  const rows = database.query(`SELECT hf.tag,count(*) count FROM hashtag_follows hf
    JOIN users u ON u.id=hf.user_id WHERE hf.tag IN (${canonical.map(() => '?').join(',')})
    AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))) GROUP BY hf.tag`)
    .all(...canonical, viewerId, viewerId, viewerId) as { tag: string; count: number }[]
  const counts = new Map(rows.map(row => [row.tag, row.count]))
  return Object.fromEntries(unique.map(tag => [tag, counts.get(canonicalByTag.get(tag)!) || 0]))
}

export function syncPostMetadata(database: Database, postId: number, body: string) {
  const flags = postContentFlags(body)
  const hashtags = extractAuthoredHashtags(body)
  const existingTags = new Set(hashtags.filter(({ tag }) => database.query(
    'SELECT 1 FROM post_hashtags WHERE tag=? LIMIT 1',
  ).get(tag)).map(({ tag }) => tag))
  const supportsTagPresentation = !!database.query(`SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='tag_aliases'
      AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='tag_display_names')`).get()
  database.query('UPDATE posts SET has_latex=?,has_links=?,has_code=? WHERE id=?')
    .run(flags.has_latex, flags.has_links, flags.has_code, postId)
  database.query('DELETE FROM post_hashtags WHERE post_id=?').run(postId)
  database.query('DELETE FROM post_mentions WHERE post_id=?').run(postId)
  const insertTag = database.query('INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES(?,?)')
  const insertMention = database.query('INSERT OR IGNORE INTO post_mentions(post_id,user_id) VALUES(?,?)')

  for (const { tag, authored } of hashtags) {
    const displayName = pascalCaseHashtagDisplayName(authored)
    if (supportsTagPresentation && !existingTags.has(tag) && displayName) {
      const aliasConflict = database.query('SELECT 1 FROM tag_aliases WHERE alias=? LIMIT 1').get(tag)
      const displayConflict = database.query(`SELECT 1 FROM tag_display_names
        WHERE tag=? AND display_name!=? LIMIT 1`).get(tag, displayName)
      if (!aliasConflict && !displayConflict) {
        database.query(`INSERT OR IGNORE INTO tag_display_names(tag,display_name)
          VALUES(?,?)`).run(tag, displayName)
      }
    }
    insertTag.run(postId, tag)
  }
  for (const handle of extractMentions(body)) {
    const mentioned = resolveHandle(database, handle)
    if (mentioned) insertMention.run(postId, mentioned.id)
  }
  syncPoll(database, postId, body)
}

export function createPost(
  database: Database,
  userId: number,
  body: string,
  parentId: number | null = null,
  publish = true,
  translation: string | null = null,
  moderationCategory: string | null = null,
  moderationScore: number | null = null,
  executionOutput: string | null = null,
  pendingKey: string | null = null,
) {
  const supportsTranslation = !!database.query(
    'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'translation\'',
  ).get()
  const result = insertRateLimitedPost(database, userId, body, parentId, postId => {
    if (supportsTranslation) database.query('UPDATE posts SET translation=? WHERE id=?').run(translation, postId)
    const supportsModerationWarning = !!database.query(
      'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'moderation_category\'',
    ).get()
    if (supportsModerationWarning) database.query(
      'UPDATE posts SET moderation_category=?,moderation_score=? WHERE id=?',
    ).run(moderationCategory, moderationScore, postId)
    if (database.query("SELECT 1 FROM pragma_table_info('posts') WHERE name='execution_output'").get()) {
      database.query('UPDATE posts SET execution_output=? WHERE id=?').run(executionOutput, postId)
    }
    syncPostMetadata(database, postId, body)
    recordHotActivity(database, postId)
    database.query(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key)
      VALUES(?,'post:' || printf('%020d',?))`).run(userId, postId)
    markLatestPostsRead(userId, [postId], database)
  }, pendingKey)
  if (publish && 'id' in result && !result.duplicate) publishPost(result.id)
  return result
}

export function isThreadLocked(database: Database, postId: number) {
  return !!database.query(`WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL
    UNION ALL
    SELECT p.id,p.parent_id FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
  ) SELECT 1 FROM ancestors JOIN post_hashtags ph ON ph.post_id=ancestors.id
    WHERE ph.tag='lock' LIMIT 1`).get(postId)
}

export function updatePost(database: Database, postId: number, body: string, translation: string | null = null,
  moderationCategory: string | null = null, moderationScore: number | null = null,
  executionOutput: string | null = null)
{
  database.transaction(() => {
    const supportsTranslation = !!database.query(
      'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'translation\'',
    ).get()
    if (supportsTranslation) {
      database.query('UPDATE posts SET body=?,translation=? WHERE id=?')
        .run(body, translation, postId)
    }
    else database.query('UPDATE posts SET body=? WHERE id=?').run(body, postId)
    const supportsModerationWarning = !!database.query(
      'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'moderation_category\'',
    ).get()
    if (supportsModerationWarning) database.query(
      'UPDATE posts SET moderation_category=?,moderation_score=? WHERE id=?',
    ).run(moderationCategory, moderationScore, postId)
    if (database.query("SELECT 1 FROM pragma_table_info('posts') WHERE name='execution_output'").get()) {
      database.query('UPDATE posts SET execution_output=? WHERE id=?').run(executionOutput, postId)
    }
    syncPostMetadata(database, postId, body)
  })()
}

export function enrichPosts(database: Database, posts: PostView[], viewerId = -1) {
  const supportsMood = !!database.query("SELECT 1 FROM pragma_table_info('users') WHERE name='mood'").get()
  const moodUserIds = [...new Set(posts.map(post => post.user_id))]
  const moods = supportsMood && moodUserIds.length
    ? new Map((database.query(`SELECT id,mood FROM users WHERE id IN (${moodUserIds.map(() => '?').join(',')})`)
      .all(...moodUserIds) as Array<{ id: number; mood: string }>).map(row => [row.id, row.mood]))
    : new Map<number, string>()
  if (!posts.length) return posts
  const moderator = moderatorViewer(database, viewerId)
  const blockViewerId = moderator ? -1 : viewerId
  const blockers = moderator && viewerId >= 0
    ? new Set((database.query(`SELECT blocker_id FROM blocks WHERE blocked_id=?
      AND blocker_id IN (${posts.map(() => '?').join(',')})`).all(viewerId, ...posts.map(post => post.user_id)) as {
        blocker_id: number
      }[]).map(row => row.blocker_id))
    : new Set<number>()
  const supportsTranslations = !!database.query(
    'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'translation\'',
  ).get()
  const supportsModerationWarnings = !!database.query(
    'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'moderation_category\'',
  ).get()
  const supportsExecutionOutput = !!database.query(
    "SELECT 1 FROM pragma_table_info('posts') WHERE name='execution_output'",
  ).get()
  const ids = posts.map(post => post.id)
  const viewerContextByPostId = new Map<number, 'reply' | 'mention'>()
  if (viewerId >= 0) {
    const contextRows = database.query(`SELECT p.id,
      CASE WHEN parent.user_id=? THEN 'reply' ELSE 'mention' END viewer_context
      FROM posts p LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.user_id!=?
        AND (parent.user_id=? OR pm.user_id IS NOT NULL)`)
      .all(viewerId, viewerId, ...ids, viewerId, viewerId) as {
        id: number
        viewer_context: 'reply' | 'mention'
      }[]
    for (const row of contextRows) viewerContextByPostId.set(row.id, row.viewer_context)
  }
  const userIds = [...new Set(posts.map(post => post.user_id))]
  const userPlaceholders = userIds.map(() => '?').join(',')
  const authors = database.query(`SELECT id,bio FROM users WHERE id IN (${userPlaceholders})`)
    .all(...userIds) as { id: number; bio: string }[]
  const bioByUserId = new Map(authors.map(author => [author.id, author.bio]))

  const mentionedHandles = [...new Set([
    ...posts.flatMap(post => [post.body, post.translation || ''].flatMap(extractMentions)),
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
  const directParentIds = [...new Set(posts.flatMap(post => post.parent_id ? [post.parent_id] : []))]
  const parentIds = directParentIds.length
    ? (database.query(`WITH RECURSIVE ancestors(id,parent_id) AS (
        SELECT id,parent_id FROM posts WHERE id IN (${directParentIds.map(() => '?').join(',')})
        UNION SELECT p.id,p.parent_id FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
      ) SELECT id FROM ancestors`).all(...directParentIds) as { id: number }[]).map(row => row.id)
    : []
  const previewPostIds = [...new Set([...ids, ...parentIds])]
  const lockedPostIds = new Set((database.query(`WITH RECURSIVE ancestors(start_id,id,parent_id) AS (
    SELECT id,id,parent_id FROM posts WHERE id IN (${previewPostIds.map(() => '?').join(',')})
    UNION ALL
    SELECT ancestors.start_id,p.id,p.parent_id FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
  ) SELECT DISTINCT ancestors.start_id id FROM ancestors
    JOIN post_hashtags ph ON ph.post_id=ancestors.id WHERE ph.tag='lock'`).all(...previewPostIds) as { id: number }[])
    .map(row => row.id))
  const viewerMentionedPostIds = viewerId < 0
    ? new Set<number>()
    : new Set((database.query(`SELECT pm.post_id FROM post_mentions pm JOIN posts p ON p.id=pm.post_id
      WHERE pm.user_id=? AND p.user_id!=? AND pm.post_id IN
      (${previewPostIds.map(() => '?').join(',')})`).all(viewerId, viewerId, ...previewPostIds) as {
      post_id: number
    }[])
      .map(row => row.post_id))
  const polls = loadPolls(database, previewPostIds, viewerId)
  const supportsLinkedPostPreviews = database.query(
    'SELECT 1 FROM pragma_table_info(\'post_link_previews\') WHERE name=\'linked_post_id\'',
  ).get()
  const previewRows = database.query(
      'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
    ).get()
    ? database.query(`SELECT lp.post_id,lp.url,lp.image_url,lp.title,lp.description,lp.site_name,lp.image_width,
      lp.image_height,lp.mime_type,${
      supportsLinkedPostPreviews
        ? `lp.linked_post_id,
      linked.user_id linked_user_id,linked.parent_id linked_parent_id,linked.body linked_body,
      linked.moderation_category linked_moderation_category,linked.moderation_score linked_moderation_score,
      ${supportsExecutionOutput ? 'linked.execution_output' : 'NULL'} linked_execution_output,
      linked_user.handle linked_handle,linked_parent.user_id linked_parent_user_id,
      linked_parent_user.handle linked_parent_handle,
      (SELECT count(*) FROM posts reply WHERE reply.parent_id=linked.id AND reply.deleted_at IS NULL) linked_reply_count,
      EXISTS(SELECT 1 FROM post_hashtags lock_tag WHERE lock_tag.post_id=linked.id AND lock_tag.tag='lock') linked_locked`
        : `NULL linked_post_id,NULL linked_user_id,NULL linked_parent_id,NULL linked_body,
      NULL linked_moderation_category,NULL linked_moderation_score,
      NULL linked_execution_output,NULL linked_handle,
      NULL linked_parent_user_id,NULL linked_parent_handle,0 linked_reply_count,0 linked_locked`
    }
      FROM post_link_previews lp
      ${
      supportsLinkedPostPreviews
        ? `LEFT JOIN posts linked ON linked.id=lp.linked_post_id AND linked.deleted_at IS NULL
      LEFT JOIN users linked_user ON linked_user.id=linked.user_id AND linked_user.deleted_at IS NULL
        AND linked_user.suspended_at IS NULL`
        : ''
    }
      ${
      supportsLinkedPostPreviews
        ? `LEFT JOIN posts linked_parent ON linked_parent.id=linked.parent_id
      LEFT JOIN users linked_parent_user ON linked_parent_user.id=linked_parent.user_id`
        : ''
    }
      WHERE lp.post_id IN
      (${previewPostIds.map(() => '?').join(',')})`).all(...previewPostIds) as {
      post_id: number
      url: string
      image_url: string
      title: string | null
      description: string | null
      site_name: string | null
      image_width: number | null
      image_height: number | null
      mime_type: string | null
      linked_post_id: number | null
      linked_user_id: number | null
      linked_parent_id: number | null
      linked_body: string | null
      linked_moderation_category: string | null
      linked_moderation_score: number | null
      linked_execution_output: string | null
      linked_handle: string | null
      linked_parent_user_id: number | null
      linked_parent_handle: string | null
      linked_reply_count: number
      linked_locked: number
    }[]
    : []
  const nativeReferenceSources = database.query(`SELECT id,body FROM posts
    WHERE id IN (${previewPostIds.map(() => '?').join(',')})`).all(...previewPostIds) as Array<{
      id: number
      body: string
    }>
  const nativeReferenceIdsByPost = new Map(nativeReferenceSources.map(source => [
    source.id,
    postReferenceIds(source.body),
  ]))
  const nativeReferenceIds = [...new Set([...nativeReferenceIdsByPost.values()].flat())]
  const linkedPolls = loadPolls(database, [
    ...new Set([
      ...previewRows.flatMap(row => row.linked_post_id ? [row.linked_post_id] : []),
      ...nativeReferenceIds,
    ]),
  ], viewerId)
  const previewsByPost = new Map<number, Record<string, LinkPreview>>()
  for (const row of previewRows) {
    const previews = previewsByPost.get(row.post_id) || {}
    previews[row.url] = { imageUrl: isImageKey(row.image_url) ? getImageUrl(row.image_url) : row.image_url,
      title: row.title ? decodeHtmlEntities(row.title) : undefined,
      description: row.description ? decodeHtmlEntities(row.description) : undefined,
      siteName: row.site_name ? decodeHtmlEntities(row.site_name) : undefined, imageWidth: row.image_width || undefined,
      imageHeight: row.image_height || undefined, mimeType: row.mime_type || undefined,
      linkedPostId: row.linked_post_id || undefined,
      linkedPost: row.linked_post_id && row.linked_user_id && row.linked_body !== null && row.linked_handle
        ? { id: row.linked_post_id, user_id: row.linked_user_id, parent_id: row.linked_parent_id, body: row.linked_body,
          moderation_category: row.linked_moderation_category, moderation_score: row.linked_moderation_score,
          execution_output: row.linked_execution_output, handle: row.linked_handle,
          reply_count: row.linked_reply_count, thread_locked: !!row.linked_locked,
          poll: linkedPolls.get(row.linked_post_id), parent: row.linked_parent_user_id && row.linked_parent_handle
            ? { user_id: row.linked_parent_user_id, handle: row.linked_parent_handle }
            : null }
        : undefined }
    previewsByPost.set(row.post_id, previews)
  }
  if (nativeReferenceIds.length) {
    const nativeRows = database.query(`SELECT p.id,p.user_id,p.parent_id,p.body,
      p.moderation_category,p.moderation_score,
      ${supportsExecutionOutput ? 'p.execution_output' : 'NULL execution_output'},u.handle,
      parent.user_id parent_user_id,parent_user.handle parent_handle,
      (SELECT count(*) FROM posts reply WHERE reply.parent_id=p.id AND reply.deleted_at IS NULL) reply_count,
      EXISTS(SELECT 1 FROM post_hashtags lock_tag WHERE lock_tag.post_id=p.id AND lock_tag.tag='lock') locked
      FROM posts p JOIN users u ON u.id=p.user_id
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN users parent_user ON parent_user.id=parent.user_id
      WHERE p.id IN (${nativeReferenceIds.map(() => '?').join(',')})
      AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
      .all(...nativeReferenceIds) as Array<{ id: number; user_id: number; parent_id: number | null; body: string;
        moderation_category: string | null; moderation_score: number | null; execution_output: string | null;
        handle: string; parent_user_id: number | null; parent_handle: string | null;
        reply_count: number; locked: number }>
    const nativeById = new Map(nativeRows.map(row => [row.id, row]))
    let origin = ''
    try {
      origin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : ''
    }
    catch { /* Startup configuration reports malformed APP_URL values. */ }
    for (const [postId, referenceIds] of nativeReferenceIdsByPost) {
      const previews = previewsByPost.get(postId) || {}
      for (const referenceId of referenceIds) {
        const row = nativeById.get(referenceId)
        if (!row) continue
        const url = `${origin}/post/${referenceId}`
        if (previews[url]) continue
        previews[url] = { imageUrl: url, linkedPostId: referenceId, linkedPost: {
          id: row.id, user_id: row.user_id, parent_id: row.parent_id, body: row.body,
          moderation_category: row.moderation_category, moderation_score: row.moderation_score,
          execution_output: row.execution_output, handle: row.handle, reply_count: row.reply_count,
          thread_locked: !!row.locked, poll: linkedPolls.get(row.id),
          parent: row.parent_user_id && row.parent_handle
            ? { user_id: row.parent_user_id, handle: row.parent_handle }
            : null,
        } }
      }
      if (Object.keys(previews).length) previewsByPost.set(postId, previews)
    }
  }
  const locationsByPost = new Map<number, NonNullable<PostView['location']>>()
  if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_locations'").get()) {
    const locationRows = database.query(`SELECT l.post_id,l.query,l.latitude,l.longitude,l.display_name,
      m.image_key,m.width,m.height FROM post_locations l JOIN location_map_previews m ON m.cache_key=
      printf('${LOCATION_ZOOM}:${LOCATION_MAP_STYLE_VERSION}:%.6f:%.6f',l.latitude,l.longitude) WHERE l.post_id IN
      (${previewPostIds.map(() => '?').join(',')})`).all(...previewPostIds) as Array<{ post_id: number; query: string;
      latitude: number; longitude: number; display_name: string; image_key: string; width: number; height: number }>
    for (const row of locationRows) {
      const location = { query: row.query, latitude: row.latitude, longitude: row.longitude,
        displayName: row.display_name }
      const [title, ...description] = row.display_name.split(',').map(part => part.trim()).filter(Boolean)
      locationsByPost.set(row.post_id, { ...location, url: osmLocationUrl(location), preview: {
        imageUrl: getImageUrl(row.image_key || locationMapKey(location)), title: title || row.query,
        description: description.join(', ') || row.display_name, imageWidth: row.width, imageHeight: row.height,
      } })
    }
  }
  const countRootIds = [...new Set([...ids, ...parentIds])]
  const placeholders = countRootIds.map(() => '?').join(',')
  const visibleReply = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const countParameters = viewerId < 0
    ? countRootIds
    : [...countRootIds, blockViewerId, blockViewerId, viewerId]
  const counts = database.query(
    `WITH RECURSIVE descendants(root_id,id,parent_id,deleted_at) AS (
      SELECT id,id,parent_id,deleted_at FROM posts WHERE id IN (${placeholders})
      UNION ALL
      SELECT descendants.root_id,p.id,p.parent_id,p.deleted_at FROM posts p
        JOIN descendants ON p.parent_id=descendants.id WHERE 1=1 ${visibleReply}
    )
    SELECT root_id,count(*) reply_count,
      sum(CASE WHEN parent_id=root_id THEN 1 ELSE 0 END) direct_reply_count FROM descendants
      WHERE id != root_id AND deleted_at IS NULL GROUP BY root_id`,
  ).all(...countParameters) as { root_id: number; reply_count: number; direct_reply_count: number }[]
  const countById = new Map(counts.map(row => [row.root_id, row.reply_count]))
  const directCountById = new Map(counts.map(row => [row.root_id, row.direct_reply_count]))

  let parents = new Map<number, ParentPost>()
  if (parentIds.length) {
    const parentPlaceholders = parentIds.map(() => '?').join(',')
    const parentFilter = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)`
    const parentParameters = viewerId < 0
      ? parentIds
      : [...parentIds, blockViewerId, blockViewerId, viewerId]
    const rows = database.query(
      `SELECT p.id,p.user_id,p.parent_id,p.body,${supportsTranslations ? 'p.translation' : 'NULL translation'},
        p.created_at,p.deleted_at,p.has_latex,p.has_links,p.has_code,
        ${supportsExecutionOutput ? 'p.execution_output' : 'NULL execution_output'},
        ${supportsModerationWarnings
          ? 'p.moderation_category,p.moderation_score'
          : 'NULL moderation_category,NULL moderation_score'},u.handle,u.bio,
        0 reply_count
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id IN (${parentPlaceholders}) ${parentFilter}`,
    ).all(...parentParameters) as ParentPost[]
    const roots = database.query(`WITH RECURSIVE ancestors(start_id,id,parent_id) AS (
      SELECT id,id,parent_id FROM posts WHERE id IN (${parentPlaceholders})
      UNION ALL
      SELECT ancestors.start_id,p.id,p.parent_id FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
    ) SELECT start_id,id top_id FROM ancestors WHERE parent_id IS NULL`).all(...parentIds) as {
      start_id: number
      top_id: number
    }[]
    const topByParentId = new Map(roots.map(root => [root.start_id, root.top_id]))
    for (const parent of rows) {
      parentBodies.push(parent.body, parent.translation || '')
      parent.reply_count = countById.get(parent.id) || 0
      parent.direct_reply_count = directCountById.get(parent.id) || 0
      parent.top_id = parent.parent_id ? topByParentId.get(parent.id) || null : null
      parent.thread_locked = lockedPostIds.has(parent.id)
      parent.link_previews = previewsByPost.get(parent.id)
      parent.location = locationsByPost.get(parent.id)
      for (const handle of extractMentions(parent.body)) addMentionBio(handle)
      for (const handle of extractMentions(parent.translation || '')) addMentionBio(handle)
      for (const handle of extractMentions(parent.bio || '')) addMentionBio(handle)
    }
    parents = new Map(rows.map(parent => [parent.id, parent]))
  }
  if (supportsMood) {
    const missingMoodUserIds = [...new Set([...parents.values()].flatMap(parent =>
      parent.user_id == null || moods.has(parent.user_id) ? [] : [parent.user_id]))]
    if (missingMoodUserIds.length) {
      for (const row of database.query(`SELECT id,mood FROM users WHERE id IN (${
        missingMoodUserIds.map(() => '?').join(',')})`).all(...missingMoodUserIds) as Array<{ id: number; mood: string }>) {
        moods.set(row.id, row.mood)
      }
    }
  }
  const hashtagCounts = visibleHashtagCounts(database, [...posts.flatMap(post => [post.body, post.translation || '']),
    ...authors.map(author => author.bio), ...parentBodies, ...[...parents.values()].map(parent => parent.bio || '')],
    viewerId)
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
  const canonicalByTag = canonicalTags(database, relevantTags)
  const canonicalRelevantTags = [...new Set(canonicalByTag.values())]
  const followedUserIds = viewerId < 0 || !relevantUserIds.length
    ? new Set<number>()
    : new Set((database.query(`SELECT following_id FROM follows WHERE follower_id=? AND following_id IN
      (${relevantUserIds.map(() => '?').join(',')})`).all(viewerId, ...relevantUserIds) as {
      following_id: number
    }[]).map(row => row.following_id))
  const followedTags = viewerId < 0 || !canonicalRelevantTags.length
    ? new Set<string>()
    : new Set((database.query(`SELECT tag FROM hashtag_follows WHERE user_id=? AND tag IN
      (${canonicalRelevantTags.map(() => '?').join(',')})`).all(viewerId, ...canonicalRelevantTags) as { tag: string }[])
      .map(row => row.tag))
  const mentionFollowing = Object.fromEntries(Object.entries(mentionUserIds)
    .map(([handle, id]) => [handle, followedUserIds.has(id)]))
  const followerUserIds = viewerId < 0 || !relevantUserIds.length
    ? new Set<number>()
    : new Set((database.query(`SELECT follower_id FROM follows WHERE following_id=? AND follower_id IN
      (${relevantUserIds.map(() => '?').join(',')})`).all(viewerId, ...relevantUserIds) as {
      follower_id: number
    }[]).map(row => row.follower_id))
  const mentionFollowsViewer = Object.fromEntries(Object.entries(mentionUserIds)
    .map(([handle, id]) => [handle, followerUserIds.has(id)]))
  const hashtagFollowing = Object.fromEntries(Object.keys(hashtagCounts)
    .map(tag => [tag, followedTags.has(canonicalByTag.get(tag)!)]))
  const bioReferences = new Map<number | undefined, BioReferenceData>()
  const bioReference = (userId: number | undefined): BioReferenceData => {
    const cached = bioReferences.get(userId)
    if (cached) return cached
    const reference = {
      hashtagCounts,
      hashtagFollowerCounts,
      hashtagFollowing,
      mentionBios,
      mentionNoteCounts,
      mentionProfileStats,
      mentionFollowing,
      mentionFollowsViewer,
      linkPreviews: userId == null ? {} : userBioLinkPreviews(database, userId),
    }
    bioReferences.set(userId, reference)
    return reference
  }
  for (const parent of parents.values()) {
    parent.mood = parent.user_id == null ? '' : moods.get(parent.user_id) || ''
    parent.profile_stats = parent.user_id == null ? undefined : profileStats.get(parent.user_id)
    parent.note_count = parent.profile_stats?.notes || 0
    parent.viewer_following = parent.user_id != null && followedUserIds.has(parent.user_id)
    parent.follows_viewer = parent.user_id != null && followerUserIds.has(parent.user_id)
    parent.mention_bios = mentionBios
    parent.mention_note_counts = mentionNoteCounts
    parent.mention_profile_stats = mentionProfileStats
    parent.mention_following = mentionFollowing
    parent.mention_follows_viewer = mentionFollowsViewer
    parent.hashtag_counts = hashtagCounts
    parent.hashtag_follower_counts = hashtagFollowerCounts
    parent.hashtag_following = hashtagFollowing
    parent.bio_reference = bioReference(parent.user_id)
    parent.poll = polls.get(parent.id)
    parent.viewer_mentioned = viewerMentionedPostIds.has(parent.id)
    parent.parent = parent.parent_id ? parents.get(parent.parent_id) || null : null
  }
  return posts.map(post => ({
    ...post,
    mood: moods.get(post.user_id) || '',
    viewer_context: viewerContextByPostId.get(post.id),
    viewer_mentioned: viewerMentionedPostIds.has(post.id),
    bio: bioByUserId.get(post.user_id) ?? post.bio ?? '',
    note_count: profileStats.get(post.user_id)?.notes || 0,
    profile_stats: profileStats.get(post.user_id),
    viewer_following: followedUserIds.has(post.user_id),
    follows_viewer: followerUserIds.has(post.user_id),
    blocked_viewer: blockers.has(post.user_id),
    mention_bios: mentionBios,
    mention_note_counts: mentionNoteCounts,
    mention_profile_stats: mentionProfileStats,
    mention_following: mentionFollowing,
    mention_follows_viewer: mentionFollowsViewer,
    hashtag_counts: hashtagCounts,
    hashtag_follower_counts: hashtagFollowerCounts,
    hashtag_following: hashtagFollowing,
    bio_reference: bioReference(post.user_id),
    link_previews: previewsByPost.get(post.id),
    location: locationsByPost.get(post.id),
    reply_count: countById.get(post.id) || 0,
    direct_reply_count: directCountById.get(post.id) || 0,
    parent: post.parent_id ? parents.get(post.parent_id) || null : null,
    poll: polls.get(post.id),
    thread_locked: lockedPostIds.has(post.id),
  }))
}

export function rewireVisibleAncestorGaps(database: Database, posts: PostView[]) {
  if (!posts.length) return posts
  const visibleIds = new Set(posts.map(post => post.id))
  const disconnected = posts.filter(post => post.parent_id && !visibleIds.has(post.parent_id) && !post.parent)
  if (!disconnected.length) return posts
  const rows = database.query(`WITH RECURSIVE ancestors(origin,id,parent_id,depth) AS (
    SELECT child.id,parent.id,parent.parent_id,1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
      WHERE child.id IN (${disconnected.map(() => '?').join(',')})
    UNION ALL
    SELECT ancestors.origin,parent.id,parent.parent_id,ancestors.depth+1 FROM ancestors
      JOIN posts parent ON parent.id=ancestors.parent_id
  ) SELECT origin,id,depth FROM ancestors ORDER BY origin,depth`).all(...disconnected.map(post => post.id)) as Array<{
    origin: number
    id: number
    depth: number
  }>
  const nearestVisibleAncestor = new Map<number, number>()
  for (const row of rows) {
    if (visibleIds.has(row.id) && !nearestVisibleAncestor.has(row.origin)) nearestVisibleAncestor.set(row.origin, row.id)
  }
  return posts.map(post => {
    const ancestorId = nearestVisibleAncestor.get(post.id)
    return ancestorId === undefined ? post : { ...post, parent_id: ancestorId }
  })
}

export function loadThreadReplies(database: Database, parentId: number, viewerId = -1) {
  const moderator = moderatorViewer(database, viewerId)
  const blockViewerId = moderator ? -1 : viewerId
  const metaVisibility = moderator ? '1' : metaThreadVisibleToViewer(viewerId)
  const supportsExecutionOutput = !!database.query(
    "SELECT 1 FROM pragma_table_info('posts') WHERE name='execution_output'",
  ).get()
  const translationColumn = database.query(
      'SELECT 1 FROM pragma_table_info(\'posts\') WHERE name=\'translation\'',
    ).get()
    ? 'translation'
    : 'NULL translation'
  const rows = database.query(`WITH RECURSIVE thread AS (
      SELECT p.*,u.handle,1 depth FROM posts p JOIN users u ON u.id=p.user_id WHERE p.parent_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
          OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
        AND ${metaVisibility}
      UNION ALL
      SELECT p.*,u.handle,thread.depth+1 FROM posts p JOIN users u ON u.id=p.user_id
        JOIN thread ON p.parent_id=thread.id WHERE (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
          OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
        AND ${metaVisibility}
    ) SELECT id,user_id,parent_id,body,${translationColumn},created_at,deleted_at,
      has_latex,has_links,has_code,${supportsExecutionOutput ? 'execution_output' : 'NULL execution_output'},handle,depth
      FROM thread ORDER BY created_at ASC,id ASC`).all(parentId, blockViewerId, blockViewerId, blockViewerId,
    viewerId, viewerId, blockViewerId, blockViewerId, blockViewerId, viewerId, viewerId) as (PostView & { depth: number })[]
  return enrichPosts(database, rows, viewerId) as Array<PostView & { depth: number }>
}
