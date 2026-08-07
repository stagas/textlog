import type { Database } from 'bun:sqlite'
import type { PersonView } from './types'

export type TrendingTag = { tag: string; count: number; following: boolean }

export function trendingTags(database: Database, viewerId: number, limit = 12,
  now = new Date().toISOString())
{
  return database.query(
    `SELECT ph.tag,count(*) count,
      EXISTS(SELECT 1 FROM hashtag_follows hf WHERE hf.user_id=? AND hf.tag=ph.tag) following,
      sum(pow(0.5,max(0,(julianday(?) - julianday(p.created_at))*24)/24.0)) trend_score,
      max(p.created_at) latest_post_at
      FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      WHERE p.deleted_at IS NULL AND p.created_at>=datetime(?,'-7 days')
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=? AND bh.tag=ph.tag))
      GROUP BY ph.tag ORDER BY trend_score DESC,latest_post_at DESC,ph.tag LIMIT ?`,
  ).all(viewerId, now, now, viewerId, viewerId, viewerId, viewerId, viewerId, limit) as TrendingTag[]
}

export function explorePivot(maxUserId: number, viewerId: number, day = new Date().toISOString().slice(0, 10)) {
  if (maxUserId < 1) return 1
  let hash = 2166136261
  for (const character of `${day}:${viewerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) % maxUserId + 1
}

export function suggestedPeople(database: Database, viewerId: number, limit = 6,
  day = new Date().toISOString().slice(0, 10))
{
  const maxUserId = (database.query('SELECT coalesce(max(id),0) id FROM users').get() as { id: number }).id
  const pivot = explorePivot(maxUserId, viewerId, day)
  const find = (operator: '>=' | '<', boundary: number, count: number) =>
    database.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following FROM users u
      WHERE u.id != ? AND u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id)
      AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
      AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL)
      AND u.id ${operator} ? ORDER BY u.id LIMIT ?`,
    ).all(viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, boundary, count) as PersonView[]

  const people = find('>=', pivot, limit)
  if (people.length < limit) people.push(...find('<', pivot, limit - people.length))
  return people
}
