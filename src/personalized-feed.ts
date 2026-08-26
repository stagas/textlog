import type { Database } from 'bun:sqlite'
import { activityAnchor } from './activity-anchor'
import { isAdmin } from './admin'
import { feedSnapshotPage } from './feed-snapshots'
import { hasUnreadForYou, hasUnreadToMe, markForYouEntriesRead, unreadForYouCount,
  unreadToMeCount } from './for-you-state'
import { resolveHandle } from './handles'
import { unreadLatestCount } from './latest-state'
import { enrichPosts, loadBioReferenceData, visibleTagFollowerCounts, visibleUserProfileStats } from './posts'
import type { PersonalizedFeedData, PersonalizedTimelineRow, User } from './types'
import { isWhisperThread, whisperThreadRelevantToViewer, whisperThreadTargetsViewer } from './whisper'

export const PERSONALIZED_FEED_SNAPSHOT_VERSION = 11

const descendsFromViewer = `EXISTS (WITH RECURSIVE ancestors(id,user_id,parent_id) AS (
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor WHERE ancestor.id=p.parent_id
  UNION ALL
  SELECT ancestor.id,ancestor.user_id,ancestor.parent_id FROM posts ancestor
    JOIN ancestors child ON ancestor.id=child.parent_id
) SELECT 1 FROM ancestors WHERE user_id=$viewer)`

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

export function loadPersonalizedFeed(database: Database, user: User, page: number, pageSize: number, toMe: boolean,
  path: string, markRead = true): PersonalizedFeedData
{
  const readsTable = toMe ? 'to_me_reads' : 'for_you_reads'
  const filter = toMe ? 'WHERE timeline.targeted_to_viewer=1' : ''
  const snapshotKind = `${toMe ? 'to-me' : 'for-you'}:v${PERSONALIZED_FEED_SNAPSHOT_VERSION}`
  const snapshot = feedSnapshotPage<PersonalizedTimelineRow>(database, snapshotKind, user.id, page,
    () =>
      database.query(`SELECT timeline.*,
      NOT EXISTS(SELECT 1 FROM ${readsTable} seen WHERE seen.user_id=$viewer
        AND seen.event_key=timeline.event_key) unread FROM (
      SELECT p.id,p.user_id,p.body,p.translation,p.created_at,p.parent_id,p.deleted_at,
        p.has_latex,p.has_links,p.has_code,u.handle,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=p.user_id) following,
        'post' activity_kind,'post:' || printf('%020d',p.id) event_key,p.user_id actor_id,
        u.handle actor_handle,u.bio actor_bio,NULL target_handle,NULL target_tag,NULL target_bio,
        0 target_is_viewer,
        0 targeted_to_viewer,NULL posts
      FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
      WHERE p.deleted_at IS NULL AND ((NOT ${isWhisperThread()} AND
        ((p.user_id=$viewer AND (parent.user_id!=$viewer OR
        ${hasVisibleDescendantFromAnotherUser})) OR p.user_id IN
        (SELECT following_id FROM follows WHERE follower_id=$viewer) OR ${descendsFromViewer} OR p.id IN
        (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
          WHERE hf.user_id=$viewer)))
        OR ${whisperThreadRelevantToViewer()})
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$viewer AND b.blocked_id=p.user_id)
          OR (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
          WHERE tph.post_id=p.id AND bh.user_id=$viewer)
        AND (p.user_id=$viewer OR (parent.user_id IS NOT $viewer AND pm.user_id IS NULL
          AND NOT ${whisperThreadTargetsViewer()}))
      UNION ALL
      SELECT p.id,p.user_id,p.body,p.translation,p.created_at,p.parent_id,p.deleted_at,
        p.has_latex,p.has_links,p.has_code,u.handle,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=p.user_id) following,
        CASE WHEN pm.user_id IS NOT NULL THEN 'mention' ELSE 'reply' END activity_kind,
        'post:' || printf('%020d',p.id) event_key,p.user_id actor_id,u.handle actor_handle,u.bio actor_bio,
        NULL target_handle,NULL target_tag,NULL target_bio,0 target_is_viewer,1 targeted_to_viewer,NULL posts
      FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=$viewer
      WHERE p.deleted_at IS NULL AND p.user_id!=$viewer
        AND (parent.user_id=$viewer OR pm.user_id IS NOT NULL OR ${whisperThreadTargetsViewer()})
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$viewer AND b.blocked_id=p.user_id)
          OR (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
          WHERE tph.post_id=p.id AND bh.user_id=$viewer)
      UNION ALL
      SELECT NULL id,actor.id user_id,NULL body,NULL translation,f.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,
        NULL has_links,NULL has_code,actor.handle,
        EXISTS(SELECT 1 FROM follows tf WHERE tf.follower_id=$viewer AND tf.following_id=target.id) following,
        'user_follow' activity_kind,
        'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',target.id) || ':' || f.created_at event_key,
        actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,
        target.handle target_handle,NULL target_tag,
        target.bio target_bio,target.id=$viewer target_is_viewer,target.id=$viewer targeted_to_viewer,
        (SELECT count(*) FROM posts tp WHERE tp.user_id=target.id AND tp.deleted_at IS NULL) posts
      FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
      WHERE f.created_at IS NOT NULL AND actor.id!=$viewer AND EXISTS
        (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id) AND target.id!=$viewer
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND target.deleted_at IS NULL AND target.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id=$viewer AND b.blocked_id IN (actor.id,target.id)
          OR b.blocked_id=$viewer AND b.blocker_id IN (actor.id,target.id))
      UNION ALL
      SELECT NULL id,actor.id user_id,NULL body,NULL translation,hf.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,
        NULL has_links,NULL has_code,actor.handle,
        EXISTS(SELECT 1 FROM hashtag_follows vt WHERE vt.user_id=$viewer AND vt.tag=hf.tag) following,
        'tag_follow' activity_kind,
        'tag-follow:' || printf('%020d',actor.id) || ':' || hf.tag || ':' || hf.created_at event_key,
        actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,
        NULL target_handle,hf.tag target_tag,NULL target_bio,
        0 target_is_viewer,0 targeted_to_viewer,(SELECT count(*) FROM post_hashtags ph JOIN posts hp ON hp.id=ph.post_id
          WHERE ph.tag=hf.tag AND hp.deleted_at IS NULL) posts
      FROM hashtag_follows hf JOIN users actor ON actor.id=hf.user_id
      WHERE hf.created_at IS NOT NULL AND hf.created_at!='1970-01-01 00:00:00' AND actor.id!=$viewer AND (EXISTS
        (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id) OR EXISTS
        (SELECT 1 FROM hashtag_follows vt WHERE vt.user_id=$viewer AND vt.tag=hf.tag))
        AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$viewer AND b.blocked_id=actor.id)
          OR (b.blocker_id=actor.id AND b.blocked_id=$viewer))
        AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=$viewer AND bh.tag=hf.tag)
      UNION ALL
      SELECT NULL id,actor.id user_id,NULL body,NULL translation,f.created_at,NULL parent_id,NULL deleted_at,NULL has_latex,
        NULL has_links,NULL has_code,actor.handle,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id) following,
        'user_follow' activity_kind,
        'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',$viewer) || ':' || f.created_at event_key,
        actor.id actor_id,actor.handle actor_handle,actor.bio actor_bio,
        NULL target_handle,NULL target_tag,
        actor.bio target_bio,1 target_is_viewer,1 targeted_to_viewer,
        (SELECT count(*) FROM posts fp WHERE fp.user_id=actor.id AND fp.deleted_at IS NULL) posts
      FROM follows f JOIN users actor ON actor.id=f.follower_id
      WHERE f.following_id=$viewer AND f.created_at IS NOT NULL AND actor.deleted_at IS NULL
        AND actor.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR (b.blocker_id=actor.id AND b.blocked_id=$viewer))
      UNION ALL
      SELECT NULL id,u.id user_id,NULL body,NULL translation,u.handle_chosen_at created_at,NULL parent_id,NULL deleted_at,
        NULL has_latex,NULL has_links,NULL has_code,u.handle,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=u.id) following,
        'signup' activity_kind,'signup:' || printf('%020d',u.id) || ':' || u.handle_chosen_at event_key,
        u.id actor_id,u.handle actor_handle,u.bio actor_bio,
        NULL target_handle,NULL target_tag,u.bio target_bio,
        0 target_is_viewer,0 targeted_to_viewer,
        (SELECT count(*) FROM posts sp WHERE sp.user_id=u.id AND sp.deleted_at IS NULL) posts
      FROM users u WHERE $admin=1 AND u.handle_chosen_at IS NOT NULL AND u.deleted_at IS NULL
        AND u.suspended_at IS NULL
      ) timeline ${filter} ORDER BY timeline.created_at DESC,timeline.event_key DESC`).all({
        viewer: user.id,
        admin: Number(isAdmin(user)),
      }) as PersonalizedTimelineRow[], pageSize)

  const readKeys = snapshot.items.length
    ? new Set((database.query(`SELECT event_key FROM ${readsTable}
    WHERE user_id=? AND event_key IN (${snapshot.items.map(() => '?').join(',')})`)
      .all(user.id, ...snapshot.items.map(row => row.event_key)) as { event_key: string }[]).map(row => row.event_key))
    : new Set<string>()
  const timeline = snapshot.items.map(row => ({ ...row, unread: Number(!readKeys.has(row.event_key)) }))
  const actorStats = visibleUserProfileStats(database, timeline.map(row => row.actor_id), user.id)
  const targets = new Map(timeline.flatMap(row => {
    if (!row.target_handle) return []
    const resolved = resolveHandle(database, row.target_handle)
    return resolved ? [[row.target_handle, resolved.id] as const] : []
  }))
  const targetStats = visibleUserProfileStats(database, [...targets.values()], user.id)
  const relevantIds = [...new Set([...timeline.map(row => row.actor_id), ...targets.values()])]
  const followerIds = relevantIds.length
    ? new Set((database.query(`SELECT follower_id FROM follows
    WHERE following_id=? AND follower_id IN (${relevantIds.map(() => '?').join(',')})`)
      .all(user.id, ...relevantIds) as { follower_id: number }[]).map(row => row.follower_id))
    : new Set<number>()
  const tagCounts = visibleTagFollowerCounts(database, timeline.flatMap(row => row.target_tag ? [row.target_tag] : []),
    user.id)
  const bioReferences = new Map(relevantIds.map(id => {
    const row = timeline.find(candidate => candidate.actor_id === id)
    const bio = row?.actor_bio || timeline.find(candidate => targets.get(candidate.target_handle || '') === id)?.target_bio || ''
    return [id, loadBioReferenceData(database, bio, id, user.id)] as const
  }))
  const enriched = new Map(
    enrichPosts(database, timeline.filter(row => ['post', 'reply', 'mention'].includes(row.activity_kind)), user.id)
      .map(post => [post.id, post]),
  )
  const resultTimeline = timeline.map(row => ({ ...row, renderedPost: row.id ? enriched.get(row.id) : undefined,
    actorProfileStats: actorStats.get(row.actor_id), actorFollowsViewer: followerIds.has(row.actor_id),
    actorBioReferences: bioReferences.get(row.actor_id),
    targetProfileStats: row.target_handle ? targetStats.get(targets.get(row.target_handle)!) : undefined,
    targetBioReferences: row.target_handle ? bioReferences.get(targets.get(row.target_handle)!) : undefined,
    targetFollowsViewer: row.target_handle ? followerIds.has(targets.get(row.target_handle)!) : undefined,
    tagFollowerCount: row.target_tag ? tagCounts[row.target_tag] || 0 : undefined })
  )
  const visitedCount = toMe ? unreadToMeCount(user.id, database) : unreadForYouCount(user.id, database)
  if (markRead) {
    const unreadTimeline = timeline.filter(row => row.unread)
    const latestEventKeys = unreadTimeline.filter(row => toMe || !row.targeted_to_viewer).map(row => row.event_key)
    markForYouEntriesRead(user.id, unreadTimeline.map(row => row.event_key), toMe, database, latestEventKeys)
  }
  const toMeCount = toMe ? visitedCount : unreadToMeCount(user.id, database)
  const forYouCount = toMe ? unreadForYouCount(user.id, database) : visitedCount
  const forYouUnread = hasUnreadForYou(user.id, database)
  const toMeUnread = hasUnreadToMe(user.id, database)
  const hasUnread = toMe ? toMeUnread : forYouUnread
  const firstUnread = hasUnread
    ? database.query(`SELECT item.position,item.payload
    FROM feed_snapshot_items item LEFT JOIN ${readsTable} seen ON seen.user_id=?
      AND seen.event_key=json_extract(item.payload,'$.event_key')
    WHERE item.snapshot_id=? AND seen.event_key IS NULL ORDER BY item.position LIMIT 1`)
      .get(user.id, snapshot.snapshotId) as { position: number; payload: string } | null
    : null
  const lastUnread = firstUnread
    ? database.query(`SELECT item.position,item.payload
    FROM feed_snapshot_items item LEFT JOIN ${readsTable} seen ON seen.user_id=?
      AND seen.event_key=json_extract(item.payload,'$.event_key')
    WHERE item.snapshot_id=? AND seen.event_key IS NULL ORDER BY item.position DESC LIMIT 1`)
      .get(user.id, snapshot.snapshotId) as { position: number; payload: string } | null
    : null
  const unreadHref = (item: { position: number; payload: string } | null) => {
    if (!item) return undefined
    const row = JSON.parse(item.payload) as PersonalizedTimelineRow
    const page = Math.floor(item.position / pageSize) + 1
    const anchor = ['post', 'reply', 'mention'].includes(row.activity_kind)
      ? `post-${row.id}`
      : activityAnchor(row.event_key)
    return `${path}${page > 1 ? `${path.includes('?') ? '&' : '?'}page=${page}` : ''}#${anchor}`
  }
  return { timeline: resultTimeline, page: snapshot.page, totalPages: snapshot.totalPages,
    toMeCount, forYouCount, latestCount: unreadLatestCount(user.id, database),
    forYouUnread, toMeUnread, unreadHref: unreadHref(firstUnread),
    lastUnreadHref: lastUnread?.position !== firstUnread?.position ? unreadHref(lastUnread) : undefined }
}
