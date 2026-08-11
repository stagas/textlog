import { db } from './db'

const visibleEvents = `
  SELECT 'post:' || printf('%020d',p.id) event_key FROM posts p
    WHERE p.deleted_at IS NULL AND (p.user_id=$viewer OR p.user_id IN
      (SELECT following_id FROM follows WHERE follower_id=$viewer) OR p.id IN
      (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
        WHERE hf.user_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=p.user_id) OR
        (b.blocker_id=p.user_id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags tph JOIN blocked_hashtags bh ON bh.tag=tph.tag
        WHERE tph.post_id=p.id AND bh.user_id=$viewer)
  UNION ALL
  SELECT 'user-follow:' || printf('%020d',actor.id) || ':' || printf('%020d',target.id) || ':' || f.created_at
    FROM follows f JOIN users actor ON actor.id=f.follower_id JOIN users target ON target.id=f.following_id
    WHERE f.created_at IS NOT NULL AND actor.id!=$viewer AND EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id)
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND target.deleted_at IS NULL AND target.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        b.blocker_id=$viewer AND b.blocked_id IN (actor.id,target.id) OR
        b.blocked_id=$viewer AND b.blocker_id IN (actor.id,target.id))
  UNION ALL
  SELECT 'tag-follow:' || printf('%020d',actor.id) || ':' || hf.tag || ':' || hf.created_at
    FROM hashtag_follows hf JOIN users actor ON actor.id=hf.user_id
    WHERE hf.created_at IS NOT NULL AND actor.id!=$viewer AND (EXISTS
      (SELECT 1 FROM follows vf WHERE vf.follower_id=$viewer AND vf.following_id=actor.id) OR EXISTS
      (SELECT 1 FROM hashtag_follows vt WHERE vt.user_id=$viewer AND vt.tag=hf.tag))
      AND actor.deleted_at IS NULL AND actor.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$viewer AND b.blocked_id=actor.id) OR
        (b.blocker_id=actor.id AND b.blocked_id=$viewer))
      AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=$viewer AND bh.tag=hf.tag)`

export function hasUnreadForYou(userId: number) {
  return !!db.query(`SELECT 1 FROM (${visibleEvents}) event WHERE NOT EXISTS
    (SELECT 1 FROM for_you_reads seen WHERE seen.user_id=$viewer AND seen.event_key=event.event_key) LIMIT 1`)
    .get({ viewer: userId })
}

export function markForYouEntriesRead(userId: number, eventKeys: string[]) {
  if (!eventKeys.length) return
  const insert = db.query('INSERT OR IGNORE INTO for_you_reads(user_id,event_key) VALUES(?,?)')
  const insertActivity = db.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
    VALUES(?,'post:' || CAST(? AS INTEGER))`)
  db.transaction(() => eventKeys.forEach(eventKey => {
    insert.run(userId, eventKey)
    const postId = eventKey.match(/^post:(\d+)$/)?.[1]
    if (postId) insertActivity.run(userId, postId)
  }))()
}

export function markAllForYouRead(userId: number) {
  db.transaction(() => {
    db.query(`INSERT OR IGNORE INTO for_you_reads(user_id,event_key)
      SELECT $viewer,event_key FROM (${visibleEvents})`).run({ viewer: userId })
    db.query(`INSERT OR IGNORE INTO activity_reads(user_id,event_key)
      SELECT user_id,'post:' || CAST(substr(event_key,6) AS INTEGER)
      FROM for_you_reads WHERE user_id=? AND event_key GLOB 'post:[0-9]*'`).run(userId)
  })()
}
