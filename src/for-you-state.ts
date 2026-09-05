import type { Database } from 'bun:sqlite'
import { isAdminEmail } from './admin'
import { markLatestPostsRead } from './latest-state'
import { isWhisperThread, whisperThreadRelevantToViewer, whisperThreadTargetsViewer } from './whisper'

// Feed badges render 99 and above as "99+"; avoid scanning the rest of a large unread projection.
const UNREAD_COUNT_LIMIT = 99

const descendsFromViewer = `EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors WHERE user_id=$viewer)`

const descendsFromFollowedUser = `EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors JOIN follows ON follows.following_id=ancestors.user_id
  WHERE follows.follower_id=$viewer AND p.created_at>=follows.created_at)`

const descendsFromFollowedTag = `EXISTS (WITH RECURSIVE ancestors(id,parent_id) AS (
  SELECT ancestor.id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors JOIN post_hashtags ph ON ph.post_id=ancestors.id
  JOIN hashtag_follows hf ON hf.tag=ph.tag
  WHERE hf.user_id=$viewer AND p.created_at>=hf.created_at)`

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

const projectedDescendsFromViewer = `EXISTS (SELECT 1 FROM post_ancestors ancestry
  WHERE ancestry.post_id=p.id AND ancestry.ancestor_user_id=$viewer)`
const projectedDescendsFromFollowedUser = `EXISTS (SELECT 1 FROM post_ancestors ancestry
  JOIN follows ON follows.following_id=ancestry.ancestor_user_id
  WHERE ancestry.post_id=p.id AND follows.follower_id=$viewer AND p.created_at>=follows.created_at)`
const projectedDescendsFromFollowedTag = `EXISTS (SELECT 1 FROM post_ancestors ancestry
  JOIN post_hashtags ph ON ph.post_id=ancestry.ancestor_id JOIN hashtag_follows hf ON hf.tag=ph.tag
  WHERE ancestry.post_id=p.id AND hf.user_id=$viewer AND p.created_at>=hf.created_at)`
const projectedVisibleDescendant = `EXISTS (SELECT 1 FROM post_ancestors ancestry JOIN posts d ON d.id=ancestry.post_id
  WHERE ancestry.ancestor_id=p.id AND d.user_id!=$viewer AND d.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$viewer AND b.blocked_id=d.user_id) OR (b.blocker_id=d.user_id AND b.blocked_id=$viewer))
  AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
    WHERE ph.post_id=d.id AND bh.user_id=$viewer))`
const projectedWhisperThread = `EXISTS (SELECT 1 FROM post_hashtags whisper_tag
  WHERE whisper_tag.tag='whisper' AND (whisper_tag.post_id=p.id OR EXISTS
    (SELECT 1 FROM post_ancestors whisper_ancestry
      WHERE whisper_ancestry.post_id=p.id AND whisper_ancestry.ancestor_id=whisper_tag.post_id)))`

function projectedEvents(sql: string, database: Database) {
  const hasAncestorProjection = !!database.query(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_ancestors'`,
  ).get()
  let projected = hasAncestorProjection
    ? sql.replaceAll(descendsFromViewer, projectedDescendsFromViewer)
    .replaceAll(descendsFromFollowedUser, projectedDescendsFromFollowedUser)
    .replaceAll(descendsFromFollowedTag, projectedDescendsFromFollowedTag)
    .replaceAll(hasVisibleDescendantFromAnotherUser, projectedVisibleDescendant)
    : sql
  if (database.query(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='personalized_post_candidates'`,
  ).get()) {
    projected = projected.replaceAll(
      `FROM posts p
    LEFT JOIN posts parent`,
      `FROM personalized_post_candidates candidate JOIN posts p ON p.id=candidate.post_id
    LEFT JOIN posts parent`,
    ).replaceAll(
      'WHERE p.deleted_at IS NULL',
      'WHERE candidate.viewer_id=$viewer AND p.deleted_at IS NULL',
    )
  }
  // Recursive whisper ancestry dominates a full unread scan. When the instance has no whisper-tagged post, all
  // three whisper predicates are provably false and can be removed before SQLite prepares the count query.
  if (!database.query('SELECT 1 FROM post_hashtags WHERE tag=\'whisper\' LIMIT 1').get()) {
    projected = projected.replaceAll(whisperThreadRelevantToViewer(), '0')
      .replaceAll(whisperThreadTargetsViewer(), '0')
      .replaceAll(isWhisperThread(), '0')
  }
  else if (hasAncestorProjection) projected = projected.replaceAll(isWhisperThread(), projectedWhisperThread)
  return projected
}

function unreadProjectedEvents(sql: string, reads: 'for_you_reads' | 'to_me_reads', database: Database) {
  const projected = projectedEvents(sql, database)
  const candidateFilter = 'candidate.viewer_id=$viewer AND p.deleted_at IS NULL'
  if (!projected.includes(candidateFilter)) return projected
  return projected.replaceAll(candidateFilter, `${candidateFilter}
      AND NOT EXISTS (SELECT 1 FROM ${reads} candidate_seen
        WHERE candidate_seen.user_id=$viewer
          AND candidate_seen.event_key='post:' || printf('%020d',p.id))`)
}

const visibleEvents = `
  SELECT 'post:' || printf('%020d',p.id) event_key FROM posts p
    LEFT JOIN posts parent ON parent.id=p.parent_id
    WHERE p.deleted_at IS NULL AND ((NOT ${isWhisperThread()} AND
      ((p.user_id=$viewer AND (parent.user_id!=$viewer OR
      ${hasVisibleDescendantFromAnotherUser})) OR p.user_id IN
      (SELECT following_id FROM follows WHERE follower_id=$viewer AND p.created_at>=created_at)
      OR ${descendsFromViewer} OR ${descendsFromFollowedUser} OR ${descendsFromFollowedTag} OR p.id IN
      (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
        WHERE hf.user_id=$viewer AND p.created_at>=hf.created_at))) OR ${whisperThreadRelevantToViewer()})
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
        (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
        WHERE tph.post_id=p.id AND bh.user_id=$viewer)
  UNION ALL
  SELECT 'post:' || printf('%020d',p.id) event_key FROM posts p
    LEFT JOIN posts parent ON parent.id=p.parent_id
    LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
    WHERE p.deleted_at IS NULL AND p.user_id!=$viewer
      AND (parent.user_id=$viewer OR pm.user_id IS NOT NULL OR ${whisperThreadTargetsViewer()})
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
        (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
        WHERE tph.post_id=p.id AND bh.user_id=$viewer)
  UNION ALL
  SELECT 'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',target.id) || ':' || f.created_at
    FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
    WHERE f.created_at IS NOT NULL AND actor.id!=$viewer AND EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id
        AND f.created_at>=vf.created_at)
      AND target.id!=$viewer AND $hidePeopleFollowActivity=0
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND target.deleted_at IS NULL AND target.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        b.blocker_id=$viewer AND b.blocked_id IN (actor.id,target.id) OR
        b.blocked_id=$viewer AND b.blocker_id IN (actor.id,target.id))
  UNION ALL
  SELECT 'tag-follow:' || printf('%020d',actor.id) || ':' || hf.tag || ':' || hf.created_at
    FROM hashtag_follows hf JOIN users actor ON actor.id=hf.user_id
    WHERE hf.created_at IS NOT NULL AND hf.created_at!='1970-01-01 00:00:00' AND actor.id!=$viewer AND (EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id
        AND hf.created_at>=vf.created_at) OR EXISTS
      (SELECT 1 FROM hashtag_follows vt WHERE vt.user_id=$viewer AND vt.tag=hf.tag
        AND hf.created_at>=vt.created_at))
      AND $hideHashtagFollowActivity=0
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR
        (b.blocker_id=actor.id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=$viewer AND bh.tag=hf.tag)
  UNION ALL
  SELECT 'user-follow:' || printf('%020d',f.follower_id) || ':' || printf('%020d',$viewer) || ':' || f.created_at
    FROM follows f JOIN users actor ON actor.id=f.follower_id
    WHERE f.following_id=$viewer AND f.created_at IS NOT NULL
      AND $hidePeopleFollowActivity=0
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR
        (b.blocker_id=actor.id AND b.blocked_id=$viewer))
  UNION ALL
  SELECT 'signup:' || printf('%020d',u.id) || ':' || u.handle_chosen_at FROM users u
    WHERE $admin=1 AND u.handle_chosen_at IS NOT NULL
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`

const visibleToMeEvents = `
  SELECT 'post:' || printf('%020d',p.id) event_key FROM posts p
    LEFT JOIN posts parent ON parent.id=p.parent_id
    LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
    WHERE p.deleted_at IS NULL AND p.user_id!=$viewer
      AND (parent.user_id=$viewer OR pm.user_id IS NOT NULL OR ${whisperThreadTargetsViewer()})
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
        (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
        WHERE tph.post_id=p.id AND bh.user_id=$viewer)
  UNION ALL
  SELECT 'user-follow:' || printf('%020d',f.follower_id) || ':' || printf('%020d',$viewer) || ':' || f.created_at
    FROM follows f JOIN users actor ON actor.id=f.follower_id
    WHERE f.following_id=$viewer AND f.created_at IS NOT NULL
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR
        (b.blocker_id=actor.id AND b.blocked_id=$viewer))`

const visibleForYouEvents = `
  SELECT event_key FROM (${visibleEvents})
  EXCEPT
  SELECT event_key FROM (${visibleToMeEvents})`

function stateParameters(userId: number, database: Database) {
  const account = database.query('SELECT * FROM users WHERE id=?').get(userId) as { email: string;
    hide_people_follow_activity?: number; hide_hashtag_follow_activity?: number } | null
  return { viewer: userId, admin: Number(!!account && isAdminEmail(account.email)),
    hidePeopleFollowActivity: account?.hide_people_follow_activity || 0,
    hideHashtagFollowActivity: account?.hide_hashtag_follow_activity || 0 }
}

export function hasUnreadForYou(userId: number, database: Database) {
  return !!database.query(`SELECT 1 FROM (${projectedEvents(visibleEvents, database)}) event WHERE NOT EXISTS
    (SELECT 1 FROM for_you_reads seen WHERE seen.user_id=$viewer AND seen.event_key=event.event_key) LIMIT 1`)
    .get(stateParameters(userId, database))
}

export function unreadForYouCount(userId: number, database: Database) {
  return (database.query(`SELECT count(*) count FROM (
    SELECT DISTINCT event_key FROM (${unreadProjectedEvents(visibleEvents, 'for_you_reads', database)}) event
    WHERE NOT EXISTS
      (SELECT 1 FROM for_you_reads seen WHERE seen.user_id=$viewer AND seen.event_key=event.event_key)
    LIMIT ${UNREAD_COUNT_LIMIT})`)
    .get(stateParameters(userId, database)) as { count: number }).count
}

export function hasUnreadToMe(userId: number, database: Database) {
  return !!database.query(`SELECT 1 FROM (${projectedEvents(visibleToMeEvents, database)}) event WHERE NOT EXISTS
    (SELECT 1 FROM to_me_reads seen WHERE seen.user_id=$viewer AND seen.event_key=event.event_key) LIMIT 1`)
    .get(stateParameters(userId, database))
}

export function unreadToMeCount(userId: number, database: Database) {
  return (database.query(`SELECT count(*) count FROM (
    SELECT DISTINCT event_key FROM (${unreadProjectedEvents(visibleToMeEvents, 'to_me_reads', database)}) event
    WHERE NOT EXISTS
      (SELECT 1 FROM to_me_reads seen WHERE seen.user_id=$viewer AND seen.event_key=event.event_key)
    LIMIT ${UNREAD_COUNT_LIMIT})`)
    .get(stateParameters(userId, database)) as { count: number }).count
}

export function markForYouEntriesRead(userId: number, eventKeys: string[], toMe: boolean, database: Database,
  latestEventKeys = eventKeys)
{
  if (!eventKeys.length) return 0
  const insert = database.query('INSERT OR IGNORE INTO for_you_reads(user_id,event_key) VALUES(?,?)')
  const insertToMe = toMe
    ? database.query('INSERT OR IGNORE INTO to_me_reads(user_id,event_key) VALUES(?,?)')
    : null
  const insertActivity = database.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
    VALUES(?,'post:' || CAST(? AS INTEGER))`)
  let changed = 0
  database.transaction(() =>
    eventKeys.forEach(eventKey => {
      changed += insert.run(userId, eventKey).changes
      changed += insertToMe?.run(userId, eventKey).changes || 0
      const postId = eventKey.match(/^post:(\d+)$/)?.[1]
      if (postId) insertActivity.run(userId, postId)
    })
  )()
  const postIds = latestEventKeys.flatMap(eventKey => {
    const postId = eventKey.match(/^post:(\d+)$/)?.[1]
    return postId ? [Number(postId)] : []
  })
  markLatestPostsRead(userId, postIds, database)
  return changed
}

export function markVisibleForYouEntriesRead(userId: number, eventKeys: string[], toMe = false, database: Database) {
  if (!eventKeys.length) return 0
  const events = projectedEvents(toMe ? visibleToMeEvents : visibleForYouEvents, database)
  const placeholders = eventKeys.map((_, index) => `$event${index}`).join(',')
  const parameters = { ...stateParameters(userId, database),
    ...Object.fromEntries(eventKeys.map((eventKey, index) => [`event${index}`, eventKey])) }
  const visible = database.query(`SELECT event_key FROM (${events}) WHERE event_key IN (${placeholders})`)
    .all(parameters) as Array<{ event_key: string }>
  const insert = database.query('INSERT OR IGNORE INTO for_you_reads(user_id,event_key) VALUES(?,?)')
  const insertToMe = toMe
    ? database.query('INSERT OR IGNORE INTO to_me_reads(user_id,event_key) VALUES(?,?)')
    : null
  const insertActivity = database.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
    VALUES(?,'post:' || CAST(? AS INTEGER))`)
  database.transaction(() =>
    visible.forEach(({ event_key: eventKey }) => {
      insert.run(userId, eventKey)
      insertToMe?.run(userId, eventKey)
      const postId = eventKey.match(/^post:(\d+)$/)?.[1]
      if (postId) insertActivity.run(userId, postId)
    })
  )()
  return visible.length
}

export function markAllForYouRead(userId: number, toMe: boolean, database: Database) {
  const events = projectedEvents(toMe ? visibleToMeEvents : visibleEvents, database)
  const parameters = stateParameters(userId, database)
  const latestPostIds = [...new Set((database.query(`SELECT event_key FROM (${events})
    WHERE event_key GLOB 'post:[0-9]*'`).all(parameters) as Array<{ event_key: string }>)
    .map(({ event_key: eventKey }) => Number(eventKey.slice(5))))]
  database.transaction(() => {
    database.query(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key)
      SELECT $viewer,event_key FROM (${events})`).run(parameters)
    if (toMe) {
      database.query(`INSERT OR IGNORE INTO to_me_reads(user_id,event_key)
      SELECT $viewer,event_key FROM (${projectedEvents(visibleToMeEvents, database)})`).run(parameters)
    }
    database.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
      SELECT user_id,'post:' || CAST(substr(event_key,6) AS INTEGER)
      FROM for_you_reads WHERE user_id=? AND event_key GLOB 'post:[0-9]*'`).run(userId)
  })()
  markLatestPostsRead(userId, latestPostIds, database)
}
