import { db } from './db'
import { isAdminEmail } from './admin'

export function hasUnreadActivity(userId: number) {
  const account = db.query('SELECT email FROM users WHERE id=?').get(userId) as { email: string } | null
  const administrator = !!account && isAdminEmail(account.email)
  return !!db.query(`WITH activity_events(event_key) AS (
    SELECT 'post:' || p.id FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE p.deleted_at IS NULL AND
        (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id!=?)) AND
        NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)) AND
        NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?)
    UNION ALL
    SELECT 'follow:' || f.follower_id || ':' || f.created_at FROM follows f
      WHERE f.following_id=? AND f.created_at IS NOT NULL AND
        NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=f.follower_id) OR
          (b.blocker_id=f.follower_id AND b.blocked_id=?))
    UNION ALL
    SELECT 'signup:' || u.id || ':' || u.handle_chosen_at FROM users u
      WHERE ?=1 AND u.handle_chosen_at IS NOT NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
  ) SELECT 1 FROM activity_events event WHERE NOT EXISTS
    (SELECT 1 FROM activity_reads seen WHERE seen.user_id=? AND seen.event_key=event.event_key) LIMIT 1`)
    .get(userId, userId, userId, userId, userId, userId, userId, userId, userId, Number(administrator), userId)
}

export function markActivityEntriesRead(userId: number, eventKeys: string[]) {
  if (!eventKeys.length) return
  const insert = db.query('INSERT OR IGNORE INTO activity_reads(user_id,event_key) VALUES(?,?)')
  db.transaction(() => {
    for (const eventKey of eventKeys) insert.run(userId, eventKey)
  })()
}

export function markAllActivityRead(userId: number) {
  const account = db.query('SELECT email FROM users WHERE id=?').get(userId) as { email: string } | null
  const administrator = !!account && isAdminEmail(account.email)
  db.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
    SELECT ?,event_key FROM (
      SELECT 'post:' || p.id event_key FROM posts p
        LEFT JOIN posts parent ON parent.id=p.parent_id
        LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
        WHERE p.deleted_at IS NULL AND
          (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id!=?)) AND
          NOT EXISTS (SELECT 1 FROM blocks b WHERE
            (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)) AND
          NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
            WHERE ph.post_id=p.id AND bh.user_id=?)
      UNION ALL
      SELECT 'follow:' || f.follower_id || ':' || f.created_at FROM follows f
        WHERE f.following_id=? AND f.created_at IS NOT NULL AND
          NOT EXISTS (SELECT 1 FROM blocks b WHERE
            (b.blocker_id=? AND b.blocked_id=f.follower_id) OR
            (b.blocker_id=f.follower_id AND b.blocked_id=?))
      UNION ALL
      SELECT 'signup:' || u.id || ':' || u.handle_chosen_at FROM users u
        WHERE ?=1 AND u.handle_chosen_at IS NOT NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
    )`).run(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId,
    Number(administrator))
}
