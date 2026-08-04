import { db } from './db'

export function hasUnreadActivity(userId: number) {
  return !!db.query(`WITH activity_events(event_key) AS (
    SELECT 'post:' || p.id FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE p.deleted_at IS NULL AND
        (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id!=?)) AND
        NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    UNION ALL
    SELECT 'follow:' || f.follower_id || ':' || f.created_at FROM follows f
      WHERE f.following_id=? AND f.created_at IS NOT NULL AND
        NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=f.follower_id) OR
          (b.blocker_id=f.follower_id AND b.blocked_id=?))
  ) SELECT 1 FROM activity_events event WHERE NOT EXISTS
    (SELECT 1 FROM activity_reads seen WHERE seen.user_id=? AND seen.event_key=event.event_key) LIMIT 1`)
    .get(userId, userId, userId, userId, userId, userId, userId, userId, userId)
}

export function markActivityEntriesRead(userId: number, eventKeys: string[]) {
  if (!eventKeys.length) return
  const insert = db.query('INSERT OR IGNORE INTO activity_reads(user_id,event_key) VALUES(?,?)')
  db.transaction(() => {
    for (const eventKey of eventKeys) insert.run(userId, eventKey)
  })()
}
