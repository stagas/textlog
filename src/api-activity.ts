import type { Database } from 'bun:sqlite'
import { isAdmin } from './admin'
import { type ApiPost, apiPost, isoTimestamp } from './api'
import { hasUnreadForYou, hasUnreadToMe } from './for-you-state'
import type { User } from './types'

type ActivityKind = 'post' | 'reply' | 'mention' | 'user_follow' | 'tag_follow' | 'signup'

type ActivityRow = {
  post_id: number | null
  created_at: string
  type: ActivityKind
  event_key: string
  actor_handle: string
  target_handle: string | null
  target_tag: string | null
  unread: number
}

type UserReference = { handle: string; url: string; api_url: string }

const hasVisibleDescendantFromAnotherUser = `EXISTS (WITH RECURSIVE descendants(id,user_id,parent_id,deleted_at) AS (
  SELECT child.id,child.user_id,child.parent_id,child.deleted_at FROM posts child WHERE child.parent_id=p.id
  UNION ALL
  SELECT child.id,child.user_id,child.parent_id,child.deleted_at FROM posts child
    JOIN descendants parent ON child.parent_id=parent.id
) SELECT 1 FROM descendants d WHERE d.user_id!=$viewer AND d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$viewer AND b.blocked_id=d.user_id) OR (b.blocker_id=d.user_id AND b.blocked_id=$viewer))
  AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=d.id AND bh.user_id=$viewer))`

export type ApiActivity = {
  id: string
  type: ActivityKind
  created_at: string
  unread: boolean
  payload: ApiPost | {
    actor: UserReference
    target?: UserReference | { tag: string; url: string; api_url: string }
  }
}

type ActivityCursor = { createdAt: string; key: string }

const descendsFromViewer = `EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors WHERE user_id=$viewer)`

function encodeCursor(cursor: ActivityCursor) {
  return Buffer.from(JSON.stringify([1, cursor.createdAt, cursor.key])).toString('base64url')
}

export function decodeActivityCursor(value?: string): ActivityCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    return Array.isArray(decoded) && decoded.length === 3 && decoded[0] === 1
        && typeof decoded[1] === 'string' && decoded[1]
        && typeof decoded[2] === 'string' && decoded[2]
      ? { createdAt: decoded[1], key: decoded[2] }
      : null
  }
  catch {
    return null
  }
}

function userReference(origin: string, handle: string): UserReference {
  const normalized = handle.toLowerCase()
  return {
    handle: normalized,
    url: `${origin}/u/${encodeURIComponent(normalized)}`,
    api_url: `${origin}/api/v1/users/${encodeURIComponent(normalized)}`,
  }
}

export function apiActivities(database: Database, origin: string, user: User, options: {
  limit: number
  cursor: ActivityCursor | null
  toMe: boolean
}) {
  const toMeFilter = options.toMe ? 'AND timeline.targeted_to_viewer=1' : ''
  const cursorFilter = options.cursor
    ? `AND (timeline.created_at < $createdAt OR
      (timeline.created_at = $createdAt AND timeline.event_key < $key))`
    : ''
  const rows = database.query(`SELECT timeline.*,
    NOT EXISTS(SELECT 1 FROM for_you_reads fyr
      WHERE fyr.user_id=$viewer AND fyr.event_key=timeline.event_key) unread
    FROM (
      SELECT p.id post_id,p.created_at,
        CASE WHEN parent.user_id=$viewer THEN 'reply'
          WHEN pm.user_id IS NOT NULL THEN 'mention' ELSE 'post' END type,
        'post:' || printf('%020d',p.id) event_key,u.handle actor_handle,
        NULL target_handle,NULL target_tag,
        CASE WHEN parent.user_id=$viewer OR pm.user_id IS NOT NULL THEN 1 ELSE 0 END targeted_to_viewer
      FROM posts p JOIN users u ON u.id=p.user_id
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
      WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL
        AND ((p.user_id=$viewer AND (parent.user_id!=$viewer OR
          ${hasVisibleDescendantFromAnotherUser})) OR p.user_id IN
          (SELECT following_id FROM follows WHERE follower_id=$viewer)
          OR ${descendsFromViewer} OR pm.user_id IS NOT NULL
          OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
            WHERE hf.user_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=p.user_id)
          OR (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=$viewer)
      UNION ALL
      SELECT NULL,f.created_at,'user_follow',
        'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',target.id) || ':' || f.created_at,
        actor.handle,target.handle,NULL,target.id=$viewer
      FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
      WHERE f.created_at IS NOT NULL AND actor.id!=$viewer
        AND (target.id=$viewer OR EXISTS (SELECT 1 FROM follows vf
          WHERE vf.follower_id=$viewer AND vf.following_id=actor.id))
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND target.deleted_at IS NULL AND target.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id IN (actor.id,target.id))
          OR (b.blocked_id=$viewer AND b.blocker_id IN (actor.id,target.id)))
      UNION ALL
      SELECT NULL,hf.created_at,'tag_follow',
        'tag-follow:' || printf('%020d',actor.id) || ':' || hf.tag || ':' || hf.created_at,
        actor.handle,NULL,hf.tag,0
      FROM hashtag_follows hf JOIN users actor ON actor.id=hf.user_id
      WHERE hf.created_at IS NOT NULL AND hf.created_at!='1970-01-01 00:00:00' AND actor.id!=$viewer
        AND (EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id)
          OR EXISTS (SELECT 1 FROM hashtag_follows vt WHERE vt.user_id=$viewer AND vt.tag=hf.tag))
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=actor.id)
          OR (b.blocker_id=actor.id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=$viewer AND bh.tag=hf.tag)
      UNION ALL
      SELECT NULL,u.handle_chosen_at,'signup',
        'signup:' || printf('%020d',u.id) || ':' || u.handle_chosen_at,u.handle,NULL,NULL,0
      FROM users u WHERE $admin=1 AND u.handle_chosen_at IS NOT NULL
        AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    ) timeline WHERE 1=1 ${toMeFilter} ${cursorFilter}
    ORDER BY timeline.created_at DESC,timeline.event_key DESC LIMIT ${options.limit + 1}`).all({
    viewer: user.id,
    admin: Number(isAdmin(user)),
    createdAt: options.cursor?.createdAt || '',
    key: options.cursor?.key || '',
  }) as ActivityRow[]
  const hasMore = rows.length > options.limit
  const selected = rows.slice(0, options.limit)
  const data = selected.flatMap((row): ApiActivity[] => {
    const common = { id: row.event_key, type: row.type, created_at: isoTimestamp(row.created_at), unread: !!row.unread }
    if (row.post_id !== null) {
      const post = apiPost(database, row.post_id, origin, user.id)
      return post ? [{ ...common, payload: post }] : []
    }
    const actor = userReference(origin, row.actor_handle)
    const target = row.target_handle
      ? userReference(origin, row.target_handle)
      : row.target_tag
      ? { tag: row.target_tag, url: `${origin}/tag/${encodeURIComponent(row.target_tag)}`,
        api_url: `${origin}/api/v1/tags/${encodeURIComponent(row.target_tag)}/posts` }
      : undefined
    return [{ ...common, payload: { actor, ...(target ? { target } : {}) } }]
  })
  const last = selected[selected.length - 1]
  return { data, has_unread: options.toMe ? hasUnreadToMe(user.id, database) : hasUnreadForYou(user.id, database),
    pagination: { next_cursor: hasMore && last
      ? encodeCursor({ createdAt: last.created_at, key: last.event_key })
      : null } }
}
