import type { Database } from 'bun:sqlite'
import type { PersonView } from './types'

export type TrendingTag = { tag: string; count: number; following: boolean }

const TRENDING_TAG_WINDOW_DAYS = 30

export function trendingTags(database: Database, viewerId: number, limit = 12, now = new Date().toISOString(),
  offset = 0)
{
  const canonical = database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'tag_aliases\'').get()
    ? 'coalesce((SELECT primary_tag FROM tag_aliases WHERE alias=ph.tag),ph.tag)'
    : 'ph.tag'
  return database.query(
    `WITH canonical_tags AS (
      SELECT DISTINCT ph.post_id,${canonical} tag FROM post_hashtags ph
    ) SELECT ct.tag,count(*) count,
      EXISTS(SELECT 1 FROM hashtag_follows hf WHERE hf.user_id=? AND hf.tag=ct.tag) following,
      sum(pow(0.5,max(0,(julianday(?) - julianday(p.created_at))*24)/24.0)) trend_score,
      max(p.created_at) latest_post_at
      FROM canonical_tags ct JOIN posts p ON p.id=ct.post_id
      WHERE p.deleted_at IS NULL AND p.created_at>=datetime(?,'-${TRENDING_TAG_WINDOW_DAYS} days')
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=? AND bh.tag=ct.tag))
      GROUP BY ct.tag ORDER BY trend_score DESC,latest_post_at DESC,ct.tag LIMIT ? OFFSET ?`,
  ).all(viewerId, now, now, viewerId, viewerId, viewerId, viewerId, viewerId, limit, offset) as TrendingTag[]
}

export function trendingTagCount(database: Database, viewerId: number, now = new Date().toISOString()) {
  const canonical = database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'tag_aliases\'').get()
    ? 'coalesce((SELECT primary_tag FROM tag_aliases WHERE alias=ph.tag),ph.tag)'
    : 'ph.tag'
  return (database.query(`WITH canonical_tags AS (
      SELECT DISTINCT ph.post_id,${canonical} tag FROM post_hashtags ph
    ) SELECT count(DISTINCT ct.tag) count FROM canonical_tags ct JOIN posts p ON p.id=ct.post_id
    WHERE p.deleted_at IS NULL AND p.created_at>=datetime(?,'-${TRENDING_TAG_WINDOW_DAYS} days')
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=? AND bh.tag=ct.tag))`)
    .get(now, viewerId, viewerId, viewerId, viewerId, viewerId) as { count: number }).count
}

export function explorePivot(maxUserId: number, viewerId: number, day = new Date().toISOString().slice(0, 10)) {
  if (maxUserId < 1) return 1
  let hash = 2166136261
  for (const character of `${day}:${viewerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) % maxUserId + 1
}

export function preserveSuggestedPeopleOrder<T extends { id: number }>(people: T[], savedIds: number[]) {
  return people.sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id))
}

export function suggestedPeople(database: Database, viewerId: number, limit = 8,
  _day = new Date().toISOString().slice(0, 10), offset = 0)
{
  return database.query(
    `WITH candidates AS (
      SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
      (SELECT count(*) FROM follows followers JOIN users follower ON follower.id=followers.follower_id
        WHERE followers.following_id=u.id AND follower.deleted_at IS NULL) follower_count,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following,
      EXISTS(SELECT 1 FROM follows rf WHERE rf.follower_id=u.id AND rf.following_id=?) followsViewer,
      (SELECT max(p.created_at) FROM posts p
        WHERE p.user_id=u.id AND p.deleted_at IS NULL) latest_post_at FROM users u
      WHERE u.id != ? AND u.deleted_at IS NULL AND u.handle_chosen_at IS NOT NULL
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
      AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL)
    )
    SELECT * FROM candidates
    ORDER BY latest_post_at DESC,id
    LIMIT ? OFFSET ?`,
  ).all(viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, limit, offset) as PersonView[]
}

export function suggestedPeopleCount(database: Database, viewerId: number,
  _day = new Date().toISOString().slice(0, 10))
{
  return (database.query(`SELECT count(*) count FROM users u WHERE u.id != ? AND u.deleted_at IS NULL
    AND u.handle_chosen_at IS NOT NULL
    AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
    AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL)`)
    .get(viewerId, viewerId, viewerId, viewerId) as { count: number }).count
}
