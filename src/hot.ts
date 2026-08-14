import type { Database } from 'bun:sqlite'

export type HotPost = {
  id: number
  user_id: number
  parent_id: number | null
  body: string
  created_at: string
  deleted_at: string | null
  has_latex?: number | null
  has_links?: number | null
  has_code?: number | null
  handle: string
  hot_score: number
  latest_activity_at: string
  reply_count: number
}

export type HotCursor = {
  asOf: string
  score: number
  latestActivityAt: string
  createdAt: string
  id: number
  direction: 'next' | 'previous'
}

export const hotRankingVersion = 33
const cursorVersion = hotRankingVersion
const activityHalfLifeHours = 6
const postWeight = 0
const directReplyWeight = 2
const replyRecencyHalfLifeHours = 1
const maxExponentiallyWeightedReplies = 15
const unboostedReplyCount = 5
const repliesPerDiscussionWeightDoubling = 1.5
const recentCommentBoost = 1
const recentCommentBoostHalfLifeHours = 1
const singleReplyParticipationWeight = 0.2
const twoReplyParticipationWeight = 0.1
const discussionReserveReplyThreshold = 4
const discussionReserveScale = 0.04
const minimumDiscussionReserve = 0.12
const maxDiscussionReserve = 0.3
const recentReplyPriorityHours = 3

function hasHotTable(database: Database) {
  return Boolean(database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_hot\'').get())
}

function hasReplyCount(database: Database) {
  return (database.query('PRAGMA table_info(post_hot)').all() as { name: string }[])
    .some(column => column.name === 'reply_count')
}

export function encodeHotCursor(cursor: HotCursor) {
  return Buffer.from(
    JSON.stringify([cursorVersion, cursor.asOf, cursor.score, cursor.latestActivityAt, cursor.createdAt, cursor.id,
      cursor.direction]),
  ).toString('base64url')
}

export function decodeHotCursor(value?: string): HotCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    const legacy = Array.isArray(decoded) && decoded.length === 6 && decoded[0] === 1
    if (!Array.isArray(decoded) || (!legacy && (decoded.length !== 7 || decoded[0] !== cursorVersion))
      || typeof decoded[1] !== 'string' || !Number.isFinite(Date.parse(decoded[1]))
      || typeof decoded[2] !== 'number' || !Number.isFinite(decoded[2]) || decoded[2] < 0
      || typeof decoded[3] !== 'string' || typeof decoded[4] !== 'string'
      || !Number.isInteger(decoded[5]) || decoded[5] < 1
      || (!legacy && !['next', 'previous'].includes(decoded[6])))
    {
      return null
    }
    return { asOf: decoded[1], score: decoded[2], latestActivityAt: decoded[3], createdAt: decoded[4], id: decoded[5],
      direction: legacy || decoded[6] === 'next' ? 'next' : 'previous' }
  }
  catch {
    return null
  }
}

export function hotCursor(post: HotPost, asOf: string, direction: HotCursor['direction'] = 'next'): HotCursor {
  return { asOf, score: post.hot_score, latestActivityAt: post.latest_activity_at, createdAt: post.created_at,
    id: post.id, direction }
}

export function recordHotActivity(database: Database, postId: number) {
  if (!hasHotTable(database)) return
  const affected = database.query(`WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM posts WHERE id=?
    UNION ALL
    SELECT parent.id,parent.parent_id FROM ancestors JOIN posts parent ON parent.id=ancestors.parent_id
  ) SELECT id FROM ancestors`).all(postId) as { id: number }[]
  if (affected.length) rebuildHotPosts(database, affected.map(post => post.id))
}

export function rebuildHotPosts(database: Database, postIds?: number[]) {
  if (!hasHotTable(database)) return
  const tracksReplyCount = hasReplyCount(database)
  if (!postIds) {
    const rankings = database.query(
      `WITH RECURSIVE descendants(candidate_id,id,user_id,created_at,deleted_at,depth) AS (
      SELECT parent_id,id,user_id,created_at,deleted_at,1 FROM posts WHERE parent_id IS NOT NULL
      UNION ALL
      SELECT parent.parent_id,descendants.id,descendants.user_id,descendants.created_at,descendants.deleted_at,
        descendants.depth+1 FROM descendants JOIN posts parent ON parent.id=descendants.candidate_id
      WHERE parent.parent_id IS NOT NULL AND descendants.deleted_at IS NULL
    ), ranked_replies AS (
      SELECT descendants.*,row_number() OVER (
        PARTITION BY descendants.candidate_id,descendants.user_id
        ORDER BY descendants.depth,descendants.created_at DESC,descendants.id DESC
      ) reply_rank FROM descendants
      JOIN posts candidate ON candidate.id=descendants.candidate_id
      WHERE descendants.deleted_at IS NULL AND descendants.user_id!=candidate.user_id
    ), activity(candidate_id,created_at,weight) AS (
      SELECT id,created_at,${postWeight} FROM posts WHERE deleted_at IS NULL
      UNION ALL
      SELECT candidate_id,created_at,${directReplyWeight}*pow(0.5,depth-1)
      FROM ranked_replies WHERE reply_rank=1
    ), latest AS (
      SELECT candidate_id,max(created_at) latest_activity_at FROM activity GROUP BY candidate_id
    ) SELECT activity.candidate_id post_id,latest.latest_activity_at,count(*)-1 reply_count,
      sum(weight*pow(0.5,max(0,(julianday(latest.latest_activity_at)-julianday(activity.created_at))*24)/${activityHalfLifeHours}.0)) score
      FROM activity JOIN latest ON latest.candidate_id=activity.candidate_id
      GROUP BY activity.candidate_id`,
    ).all() as { post_id: number; latest_activity_at: string; reply_count: number; score: number }[]
    database.query(tracksReplyCount
      ? 'UPDATE post_hot SET score=0,reply_count=0,score_updated_at=\'1970-01-01 00:00:00\',latest_activity_at=\'1970-01-01 00:00:00\''
      : 'UPDATE post_hot SET score=0,score_updated_at=\'1970-01-01 00:00:00\',latest_activity_at=\'1970-01-01 00:00:00\'')
      .run()
    const update = database.query(tracksReplyCount
      ? 'UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
      : 'UPDATE post_hot SET score=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?')
    for (const ranking of rankings) {
      if (tracksReplyCount) {
        update.run(ranking.score, ranking.reply_count, ranking.latest_activity_at, ranking.latest_activity_at,
          ranking.post_id)
      }
      else update.run(ranking.score, ranking.latest_activity_at, ranking.latest_activity_at, ranking.post_id)
    }
    return
  }
  const filter = postIds?.length ? `WHERE p.id IN (${postIds.map(() => '?').join(',')})` : ''
  const candidates = database.query(`SELECT p.id FROM posts p ${filter}`).all(...(postIds || [])) as { id: number }[]
  const activity = database.query(`WITH RECURSIVE descendants(id,user_id,created_at,deleted_at,depth) AS (
    SELECT id,user_id,created_at,deleted_at,1 FROM posts WHERE parent_id=?
    UNION ALL
    SELECT child.id,child.user_id,child.created_at,child.deleted_at,descendants.depth+1 FROM descendants
    JOIN posts child ON child.parent_id=descendants.id WHERE descendants.deleted_at IS NULL
  ), ranked_replies AS (
    SELECT descendants.*,row_number() OVER (
      PARTITION BY descendants.user_id
      ORDER BY descendants.depth,descendants.created_at DESC,descendants.id DESC
    ) reply_rank FROM descendants
    JOIN posts candidate ON candidate.id=?
    WHERE descendants.deleted_at IS NULL AND descendants.user_id!=candidate.user_id
  ), activity(id,created_at,weight) AS (
    SELECT id,created_at,${postWeight} FROM posts WHERE id=? AND deleted_at IS NULL
    UNION ALL
    SELECT id,created_at,${directReplyWeight}*pow(0.5,depth-1) FROM ranked_replies WHERE reply_rank=1
  ) SELECT created_at,weight FROM activity`)
  const update = database.query(tracksReplyCount
    ? 'UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
    : 'UPDATE post_hot SET score=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?')
  for (const candidate of candidates) {
    const events = activity.all(candidate.id, candidate.id, candidate.id) as { created_at: string; weight: number }[]
    if (!events.length) {
      if (tracksReplyCount) update.run(0, 0, '1970-01-01 00:00:00', '1970-01-01 00:00:00', candidate.id)
      else update.run(0, '1970-01-01 00:00:00', '1970-01-01 00:00:00', candidate.id)
      continue
    }
    const latest = events.reduce((value, event) => event.created_at > value ? event.created_at : value,
      events[0].created_at)
    const score = events.reduce((sum, event) =>
      sum
      + event.weight * Math.pow(0.5, Math.max(0, (Date.parse(`${latest.replace(' ', 'T')}Z`)
          - Date.parse(`${event.created_at.replace(' ', 'T')}Z`)) / (activityHalfLifeHours * 3_600_000))), 0)
    if (tracksReplyCount) update.run(score, events.length - 1, latest, latest, candidate.id)
    else update.run(score, latest, latest, candidate.id)
  }
}

export function removeHotActivity(database: Database, postId: number) {
  if (!hasHotTable(database)) return
  const affected = database.query(`WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM posts WHERE id=?
    UNION ALL
    SELECT parent.id,parent.parent_id FROM ancestors JOIN posts parent ON parent.id=ancestors.parent_id
  ) SELECT id FROM ancestors`).all(postId) as { id: number }[]
  if (!affected.length) return
  rebuildHotPosts(database, affected.map(post => post.id))
}

export function getHotPosts(
  database: Database,
  limit: number,
  cursor: HotCursor | null = null,
  asOf: Date | string = new Date(),
  viewerId = -1,
  publicOnly = false,
  minimumDiscussionReplies = 0,
) {
  const timestamp = cursor?.asOf || (asOf instanceof Date ? asOf.toISOString() : asOf)
  const filters = ['p.deleted_at IS NULL', 'ranked.hot_score > 0']
  const parameters: Array<string | number> = [timestamp]
  if (viewerId >= 0) {
    filters.push(`NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    parameters.push(viewerId, viewerId)
    filters.push(`NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`)
    parameters.push(viewerId)
  }
  if (publicOnly) filters.push('u.deleted_at IS NULL')
  if (minimumDiscussionReplies > 0) filters.push('h.reply_count>=?')
  if (minimumDiscussionReplies > 0) parameters.push(minimumDiscussionReplies)
  if (cursor) {
    const comparison = cursor.direction === 'previous' ? '>' : '<'
    filters.push(`(ranked.hot_score ${comparison} ? OR (ranked.hot_score = ? AND
      (h.latest_activity_at ${comparison} ? OR (h.latest_activity_at = ? AND
      (p.created_at ${comparison} ? OR (p.created_at = ? AND p.id ${comparison} ?))))))`)
    parameters.push(cursor.score, cursor.score, cursor.latestActivityAt, cursor.latestActivityAt, cursor.createdAt,
      cursor.createdAt, cursor.id)
  }
  parameters.push(limit)
  const rows = database.query(`WITH ranking_time(as_of) AS (VALUES(?)), scored AS (
    SELECT h.post_id,h.reply_count,
      max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24) reply_age_hours,
      h.score
      *CASE h.reply_count WHEN 1 THEN ${singleReplyParticipationWeight}
        WHEN 2 THEN ${twoReplyParticipationWeight} ELSE 1 END
      *pow(2,max(0,min(h.reply_count,${maxExponentiallyWeightedReplies})-${unboostedReplyCount})
        /${repliesPerDiscussionWeightDoubling})
      *pow(0.5,max(0,(julianday(ranking_time.as_of) - julianday(h.score_updated_at))*24)
        /${replyRecencyHalfLifeHours}.0)
      *(1 + CASE WHEN h.reply_count > 0 THEN ${recentCommentBoost}.0
        *pow(0.5,max(0,(julianday(ranking_time.as_of) - julianday(h.latest_activity_at))*24)
          /${recentCommentBoostHalfLifeHours}.0) ELSE 0 END) recency_score,
      CASE WHEN h.reply_count >= ${discussionReserveReplyThreshold} THEN
        max(${minimumDiscussionReserve},min(${maxDiscussionReserve},${discussionReserveScale}*pow(2,
          (min(h.reply_count,${maxExponentiallyWeightedReplies})-${discussionReserveReplyThreshold})
            /${repliesPerDiscussionWeightDoubling}))) ELSE 0 END discussion_reserve
    FROM post_hot h JOIN posts p ON p.id=h.post_id CROSS JOIN ranking_time
  ), ranked AS (
    SELECT post_id,CASE
      WHEN reply_count>=3 AND reply_age_hours<=${recentReplyPriorityHours} THEN 1+recency_score
      WHEN reply_count>=3 THEN discussion_reserve
      ELSE recency_score END hot_score FROM scored
  ) SELECT p.*,u.handle,ranked.hot_score,h.latest_activity_at,h.reply_count
    FROM ranked JOIN post_hot h ON h.post_id=ranked.post_id
    JOIN posts p ON p.id=ranked.post_id JOIN users u ON u.id=p.user_id
    WHERE ${filters.join(' AND ')}
    ORDER BY ranked.hot_score ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      h.latest_activity_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.created_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...parameters) as HotPost[]
  return cursor?.direction === 'previous' ? rows.reverse() : rows
}
