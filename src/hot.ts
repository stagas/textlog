import type { Database } from 'bun:sqlite'

export type HotPost = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  created_at: string
  deleted_at: string | null
  handle: string
  hot_score: number
  latest_activity_at: string
}

export function getHotPosts(
  database: Database,
  limit: number,
  offset: number,
  asOf: Date | string = new Date(),
  viewerId = -1,
) {
  const timestamp = asOf instanceof Date ? asOf.toISOString() : asOf
  const activityFilter = viewerId < 0 ? '' : `AND NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id=? AND b.blocked_id=event_user_id) OR (b.blocker_id=event_user_id AND b.blocked_id=?)
  )`
  const candidateFilter = viewerId < 0 ? '' : `WHERE NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)
  )`
  const parameters = viewerId < 0
    ? [timestamp, limit, offset]
    : [timestamp, viewerId, viewerId, viewerId, viewerId, limit, offset]
  return database.query(`
    WITH RECURSIVE activity(candidate_id,event_id,event_user_id,created_at,deleted_at) AS (
      SELECT id,id,user_id,created_at,deleted_at
      FROM posts
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT activity.candidate_id,child.id,child.user_id,child.created_at,child.deleted_at
      FROM activity
      JOIN posts child ON child.parent_id=activity.event_id
    ), ranked AS (
      SELECT candidate_id,
        sum(pow(0.5, max(0, (julianday(?) - julianday(created_at)) * 24) / 24.0)) hot_score,
        max(created_at) latest_activity_at
      FROM activity
      WHERE deleted_at IS NULL ${activityFilter}
      GROUP BY candidate_id
    )
    SELECT p.*,u.handle,ranked.hot_score,ranked.latest_activity_at
    FROM ranked
    JOIN posts p ON p.id=ranked.candidate_id
    JOIN users u ON u.id=p.user_id
    ${candidateFilter}
    ORDER BY ranked.hot_score DESC,ranked.latest_activity_at DESC,p.created_at DESC,p.id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters) as HotPost[]
}
