import type { Database } from 'bun:sqlite'
import { excludesWhisperPosts } from './whisper'
import { excludesMetaPosts } from './meta-thread'

function usesCompactReads(database: Database) {
  return !!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'latest_read_state\'').get()
}

function excludesExistingWhispers(database: Database) {
  return database.query("SELECT 1 FROM post_hashtags WHERE tag='whisper' LIMIT 1").get()
    ? excludesWhisperPosts()
    : '1'
}

export function latestPostState(userId: number, database: Database) {
  const read = usesCompactReads(database)
    ? `p.id<=coalesce((SELECT through_post_id FROM latest_read_state WHERE user_id=?),0)
      OR EXISTS (SELECT 1 FROM latest_read_exceptions r WHERE r.user_id=? AND r.post_id=p.id)`
    : 'EXISTS (SELECT 1 FROM latest_reads r WHERE r.user_id=? AND r.post_id=p.id)'
  return database.query(`SELECT p.id,
    NOT (${read}) unread,
    CASE WHEN parent.user_id=? OR pm.user_id IS NOT NULL THEN 1 ELSE 0 END targeted_to_viewer
    FROM posts p
    LEFT JOIN posts parent ON parent.id=p.parent_id
    LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
    WHERE p.deleted_at IS NULL
      AND ${excludesExistingWhispers(database)}
      AND ${excludesMetaPosts()}
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)
    ORDER BY p.id DESC`).all(...(usesCompactReads(database)
    ? [userId, userId, userId, userId, userId, userId, userId]
    : [userId, userId, userId, userId, userId, userId])) as Array<{
      id: number
      unread: number
      targeted_to_viewer: number
    }>
}

export function latestUnreadPostState(userId: number, database: Database) {
  const compact = usesCompactReads(database)
  const unread = compact
    ? `p.id>coalesce((SELECT through_post_id FROM latest_read_state WHERE user_id=?),0)
      AND NOT EXISTS (SELECT 1 FROM latest_read_exceptions r WHERE r.user_id=? AND r.post_id=p.id)`
    : 'NOT EXISTS (SELECT 1 FROM latest_reads r WHERE r.user_id=? AND r.post_id=p.id)'
  return database.query(`SELECT p.id,1 unread,
    CASE WHEN parent.user_id=? OR pm.user_id IS NOT NULL THEN 1 ELSE 0 END targeted_to_viewer
    FROM posts p
    LEFT JOIN posts parent ON parent.id=p.parent_id
    LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
    WHERE p.deleted_at IS NULL AND ${unread}
      AND ${excludesExistingWhispers(database)}
      AND ${excludesMetaPosts()}
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)
    ORDER BY p.id DESC`).all(...(compact
    ? [userId, userId, userId, userId, userId, userId, userId]
    : [userId, userId, userId, userId, userId, userId])) as Array<{
      id: number
      unread: 1
      targeted_to_viewer: number
    }>
}

export function markLatestPostsRead(userId: number, postIds: number[], database: Database) {
  if (!postIds.length) return
  if (usesCompactReads(database)) {
    const insert = database.query(`INSERT OR IGNORE INTO latest_read_exceptions(user_id,post_id)
      SELECT ?,p.id FROM posts p WHERE p.id=? AND p.id>coalesce(
        (SELECT through_post_id FROM latest_read_state WHERE user_id=?),0)`)
    database.transaction(() => {
      postIds.forEach(id => insert.run(userId, id, userId))
      database.query(`DELETE FROM latest_read_exceptions WHERE user_id=? AND post_id<=coalesce(
        (SELECT through_post_id FROM latest_read_state WHERE user_id=?),0)`).run(userId, userId)
    })()
    return
  }
  if (!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'latest_reads\'').get()) return
  const insert = database.query('INSERT OR IGNORE INTO latest_reads(user_id,post_id) VALUES(?,?)')
  database.transaction(() => postIds.forEach(id => insert.run(userId, id)))()
}

export function unreadLatestCount(userId: number, database: Database) {
  const read = usesCompactReads(database)
    ? `p.id<=coalesce((SELECT through_post_id FROM latest_read_state WHERE user_id=?),0)
      OR EXISTS (SELECT 1 FROM latest_read_exceptions r WHERE r.user_id=? AND r.post_id=p.id)`
    : 'EXISTS (SELECT 1 FROM latest_reads r WHERE r.user_id=? AND r.post_id=p.id)'
  return (database.query(`SELECT count(*) count FROM posts p
    WHERE p.deleted_at IS NULL
      AND ${excludesExistingWhispers(database)}
      AND ${excludesMetaPosts()}
      AND NOT (${read})
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`).get(...(usesCompactReads(database)
    ? [userId, userId, userId, userId, userId]
    : [userId, userId, userId, userId])) as { count: number }).count
}

export function initializeLatestReads(userId: number, database: Database) {
  if (usesCompactReads(database)) {
    database.query(`INSERT INTO latest_read_state(user_id,through_post_id)
      VALUES(?,coalesce((SELECT max(id) FROM posts),0))
      ON CONFLICT(user_id) DO UPDATE SET through_post_id=max(through_post_id,excluded.through_post_id)`)
      .run(userId)
    return
  }
  if (!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'latest_reads\'').get()) return
  database.query(`INSERT OR IGNORE INTO latest_reads(user_id,post_id)
    SELECT ?,id FROM posts WHERE deleted_at IS NULL`).run(userId)
}

export function markAllLatestRead(userId: number, database: Database) {
  if (usesCompactReads(database)) {
    database.transaction(() => {
      database.query(`INSERT INTO latest_read_state(user_id,through_post_id)
        VALUES(?,coalesce((SELECT max(id) FROM posts),0))
        ON CONFLICT(user_id) DO UPDATE SET through_post_id=max(through_post_id,excluded.through_post_id)`)
        .run(userId)
      database.query('DELETE FROM latest_read_exceptions WHERE user_id=?').run(userId)
    })()
    return
  }
  database.query(`INSERT OR IGNORE INTO latest_reads(user_id,post_id)
    SELECT ?,id FROM posts WHERE deleted_at IS NULL`).run(userId)
}
