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
  activity_count?: number
}

export type HotCursor = {
  asOf: string
  score: number
  latestActivityAt: string
  createdAt: string
  id: number
  direction: 'next' | 'previous'
}

export const hotRankingVersion = 92
const cursorVersion = hotRankingVersion
const activityHalfLifeHours = 6
const postWeight = 0
const directReplyWeight = 2
const pollVoteWeight = 1
const replyRecencyHalfLifeHours = 0.5
const maxExponentiallyWeightedReplies = 15
const unboostedReplyCount = 5
const repliesPerDiscussionWeightDoubling = 1.5
const recentCommentBoost = 1
const recentCommentBoostHalfLifeHours = 0.5
const singleReplyParticipationWeight = 0.2
const singleReplyRecentActivityWeight = 0.05
const twoReplyParticipationWeight = 0.1
const discussionReserveReplyThreshold = 4
const discussionReserveScale = 0.04
const minimumDiscussionReserve = 0.235
const maxDiscussionReserve = 0.3
const discussionParticipantReserveScale = 0.001
const discussionParticipantReserveHours = 96
const longLivedDiscussionReplyThreshold = 7
const recentDiscussionReserve = 0.02
const recentDiscussionReserveHalfLifeHours = 24
const recentReplyPriorityHours = 24
const recentReplyPriorityHalfLifeHours = 3
const conversationDepthThreshold = 5
const conversationDepthScale = 0.01
const maxConversationDepthReserve = 0.1
const conversationDepthHalfLifeHours = 72
const longDiscussionCommentThreshold = 10
const longDiscussionCommentScale = 0.005
const longDiscussionCommentsPerDoubling = 5
const replyCandidateDepthWeight = 0.6
const replyCandidateBaseWeight = 0.02
const replyRootCoverageScale = 0.00000005
const hotTailRecencyHalfLifeHours = 6
const hotTailRecencyFloor = 0.000000000001
const hotTailRecencyFloorHalfLifeHours = 24
const hotTailRecencyDepthWeight = 0.1
const staleTailPostHours = 168
const staleTailPostHalfLifeHours = 6
const quietSmallDiscussionTailWeight = 0.001
const veryRecentReplyCandidateHours = 4
const recentPostBoost = 4
const recentPostBoostHours = 24
const recentPostTierBonus = 100
const yesterdayPostHours = 48
const yesterdayPostTierBonus = 50
const recentReplyActivityBoost = 300
const recentParticipantActivityWeight = 100
const recentParticipantActivityHalfLifeHours = 1
const matureDiscussionLowTierBonus = 16
const matureDiscussionLowTierHours = 48

function hasHotTable(database: Database) {
  return Boolean(database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_hot\'').get())
}

function hasReplyCount(database: Database) {
  return (database.query('PRAGMA table_info(post_hot)').all() as { name: string }[])
    .some(column => column.name === 'reply_count')
}

function hasActivityCount(database: Database) {
  return (database.query('PRAGMA table_info(post_hot)').all() as { name: string }[])
    .some(column => column.name === 'activity_count')
}

function hasPollVotes(database: Database) {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='poll_votes'").get())
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
  const tracksActivityCount = hasActivityCount(database)
  const tracksPollVotes = hasPollVotes(database)
  const tracksAccountGroups = (database.query('PRAGMA table_info(users)').all() as { name: string }[])
    .some(column => column.name === 'account_group_id')
  const replyIdentity = tracksAccountGroups
    ? 'COALESCE(reply_user.account_group_id,-descendants.user_id)'
    : 'descendants.user_id'
  const candidateIdentity = tracksAccountGroups
    ? 'COALESCE(candidate_user.account_group_id,-candidate_user.id)'
    : 'candidate_user.id'
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
        PARTITION BY descendants.candidate_id,${replyIdentity}
        ORDER BY descendants.depth,descendants.created_at DESC,descendants.id DESC
      ) reply_rank FROM descendants
      JOIN posts candidate ON candidate.id=descendants.candidate_id
      LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
      JOIN users candidate_user ON candidate_user.id=candidate.user_id
      WHERE descendants.deleted_at IS NULL
        AND ${replyIdentity}!=${candidateIdentity}
    ), activity(candidate_id,created_at,weight,is_reply) AS (
      SELECT id,created_at,${postWeight},0 FROM posts WHERE deleted_at IS NULL
      UNION ALL
      SELECT candidate_id,created_at,${directReplyWeight}*pow(0.5,depth-1),1
      FROM ranked_replies WHERE reply_rank=1
      ${tracksPollVotes ? `UNION ALL
      SELECT votes.post_id,votes.created_at,${pollVoteWeight},0 FROM poll_votes votes
      JOIN posts voted_post ON voted_post.id=votes.post_id WHERE voted_post.deleted_at IS NULL` : ''}
    ), recency_replies AS (
      SELECT descendants.candidate_id,descendants.created_at FROM descendants
      JOIN posts candidate ON candidate.id=descendants.candidate_id
      LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
      JOIN users candidate_user ON candidate_user.id=candidate.user_id
      WHERE descendants.deleted_at IS NULL
        AND ${replyIdentity}!=${candidateIdentity}
    ), latest AS (
      SELECT candidate_id,max(created_at) latest_activity_at FROM (
        SELECT candidate_id,created_at FROM activity
        UNION ALL
        SELECT candidate_id,created_at FROM recency_replies
      ) GROUP BY candidate_id
    ), totals AS (
      SELECT descendants.candidate_id,count(*) activity_count FROM descendants
      JOIN posts candidate ON candidate.id=descendants.candidate_id
      LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
      JOIN users candidate_user ON candidate_user.id=candidate.user_id
      WHERE descendants.deleted_at IS NULL AND ${replyIdentity}!=${candidateIdentity}
      GROUP BY descendants.candidate_id
    ) SELECT activity.candidate_id post_id,latest.latest_activity_at,sum(activity.is_reply) reply_count,
      COALESCE(totals.activity_count,0) activity_count,
      sum(weight*pow(0.5,max(0,(julianday(latest.latest_activity_at)-julianday(activity.created_at))*24)/${activityHalfLifeHours}.0)) score
      FROM activity JOIN latest ON latest.candidate_id=activity.candidate_id
      LEFT JOIN totals ON totals.candidate_id=activity.candidate_id
      GROUP BY activity.candidate_id`,
    ).all() as { post_id: number; latest_activity_at: string; reply_count: number; activity_count: number;
      score: number }[]
    database.query(tracksReplyCount
      ? `UPDATE post_hot SET score=0,reply_count=0${tracksActivityCount ? ',activity_count=0' : ''},
        score_updated_at='1970-01-01 00:00:00',latest_activity_at='1970-01-01 00:00:00'`
      : 'UPDATE post_hot SET score=0,score_updated_at=\'1970-01-01 00:00:00\',latest_activity_at=\'1970-01-01 00:00:00\'')
      .run()
    const update = database.query(tracksReplyCount && tracksActivityCount
      ? 'UPDATE post_hot SET score=?,reply_count=?,activity_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
      : tracksReplyCount
      ? 'UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
      : 'UPDATE post_hot SET score=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?')
    for (const ranking of rankings) {
      if (tracksReplyCount && tracksActivityCount) {
        update.run(ranking.score, ranking.reply_count, ranking.activity_count, ranking.latest_activity_at,
          ranking.latest_activity_at, ranking.post_id)
      }
      else if (tracksReplyCount) {
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
      PARTITION BY ${replyIdentity}
      ORDER BY descendants.depth,descendants.created_at DESC,descendants.id DESC
    ) reply_rank FROM descendants
    JOIN posts candidate ON candidate.id=?
    LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
    JOIN users candidate_user ON candidate_user.id=candidate.user_id
    WHERE descendants.deleted_at IS NULL
      AND ${replyIdentity}!=${candidateIdentity}
  ), activity(id,created_at,weight,boosts_recency,is_reply) AS (
    SELECT id,created_at,${postWeight},1,0 FROM posts WHERE id=? AND deleted_at IS NULL
    UNION ALL
    SELECT id,created_at,${directReplyWeight}*pow(0.5,depth-1),1,1 FROM ranked_replies WHERE reply_rank=1
    UNION ALL
    SELECT descendants.id,descendants.created_at,0,
      CASE WHEN ${replyIdentity}!=${candidateIdentity} THEN 1 ELSE 0 END,0
    FROM descendants
    JOIN posts candidate ON candidate.id=?
    LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
    JOIN users candidate_user ON candidate_user.id=candidate.user_id
    WHERE descendants.deleted_at IS NULL
    ${tracksPollVotes ? `UNION ALL
    SELECT votes.option_id,votes.created_at,${pollVoteWeight},1,0 FROM poll_votes votes
    WHERE votes.post_id=?` : ''}
  ) SELECT created_at,weight,boosts_recency,is_reply FROM activity`)
  const update = database.query(tracksReplyCount && tracksActivityCount
    ? 'UPDATE post_hot SET score=?,reply_count=?,activity_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
    : tracksReplyCount
    ? 'UPDATE post_hot SET score=?,reply_count=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?'
    : 'UPDATE post_hot SET score=?,score_updated_at=?,latest_activity_at=? WHERE post_id=?')
  for (const candidate of candidates) {
    const events = activity.all(candidate.id, candidate.id, candidate.id, candidate.id,
      ...(tracksPollVotes ? [candidate.id] : [])) as {
      created_at: string
      weight: number
      boosts_recency: number
      is_reply: number
    }[]
    if (!events.length) {
      if (tracksReplyCount && tracksActivityCount) {
        update.run(0, 0, 0, '1970-01-01 00:00:00', '1970-01-01 00:00:00', candidate.id)
      }
      else if (tracksReplyCount) update.run(0, 0, '1970-01-01 00:00:00', '1970-01-01 00:00:00', candidate.id)
      else update.run(0, '1970-01-01 00:00:00', '1970-01-01 00:00:00', candidate.id)
      continue
    }
    const recencyEvents = events.filter(event => event.boosts_recency)
    const latest = recencyEvents.length
      ? recencyEvents.reduce((value, event) => event.created_at > value ? event.created_at : value,
        recencyEvents[0].created_at)
      : events.reduce((value, event) => event.created_at > value ? event.created_at : value, events[0].created_at)
    const score = events.reduce((sum, event) =>
      sum
      + event.weight * Math.pow(0.5, Math.max(0, (Date.parse(`${latest.replace(' ', 'T')}Z`)
          - Date.parse(`${event.created_at.replace(' ', 'T')}Z`)) / (activityHalfLifeHours * 3_600_000))), 0)
    const replyCount = events.filter(event => event.is_reply).length
    const activityCount = events.filter(event => event.weight === 0 && event.boosts_recency).length - 1
    if (tracksReplyCount && tracksActivityCount) {
      update.run(score, replyCount, activityCount, latest, latest, candidate.id)
    }
    else if (tracksReplyCount) update.run(score, replyCount, latest, latest, candidate.id)
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
  const tracksAccountGroups = (database.query('PRAGMA table_info(users)').all() as { name: string }[])
    .some(column => column.name === 'account_group_id')
  const activityAuthorIdentity = tracksAccountGroups
    ? 'COALESCE(activity_user.account_group_id,-activity_user.id)'
    : 'activity_user.id'
  const candidateAuthorIdentity = tracksAccountGroups
    ? 'COALESCE(candidate_user.account_group_id,-candidate_user.id)'
    : 'candidate_user.id'
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
  if (minimumDiscussionReplies > 0) {
    filters.push(`(h.reply_count>=? OR (h.reply_count BETWEEN 1 AND 2
      AND max(0,(julianday(?) - julianday(h.latest_activity_at))*24)<=${veryRecentReplyCandidateHours}))`)
    parameters.push(minimumDiscussionReplies, timestamp)
  }
  if (cursor) {
    const comparison = cursor.direction === 'previous' ? '>' : '<'
    filters.push(`(ranked.hot_score ${comparison} ? OR (ranked.hot_score = ? AND
      (h.latest_activity_at ${comparison} ? OR (h.latest_activity_at = ? AND
      (p.created_at ${comparison} ? OR (p.created_at = ? AND p.id ${comparison} ?))))))`)
    parameters.push(cursor.score, cursor.score, cursor.latestActivityAt, cursor.latestActivityAt, cursor.createdAt,
      cursor.createdAt, cursor.id)
  }
  parameters.push(limit)
  const rows = database.query(`WITH RECURSIVE post_depth(id,depth,root_id) AS (
    SELECT id,0,id FROM posts WHERE parent_id IS NULL
    UNION ALL
    SELECT child.id,post_depth.depth+1,post_depth.root_id
      FROM post_depth JOIN posts child ON child.parent_id=post_depth.id
  ), direct_counts AS (
    SELECT p.id,count(child.id) direct_reply_count FROM posts p
    LEFT JOIN posts child ON child.parent_id=p.id AND child.deleted_at IS NULL GROUP BY p.id
  ), branch_candidates AS (
    SELECT root.id root_id,child.id head_id,root_count.direct_reply_count root_direct_replies,
      child_count.direct_reply_count head_direct_replies,
      row_number() OVER (PARTITION BY root.id
        ORDER BY child_count.direct_reply_count DESC,child.created_at ASC,child.id ASC) branch_rank
    FROM posts root JOIN posts child ON child.parent_id=root.id AND child.deleted_at IS NULL
    JOIN direct_counts root_count ON root_count.id=root.id
    JOIN direct_counts child_count ON child_count.id=child.id
    WHERE root.parent_id IS NULL AND root.deleted_at IS NULL
  ), branch_heads AS (
    SELECT root_id,head_id FROM branch_candidates
    WHERE branch_rank=1 AND head_direct_replies>=2 AND head_direct_replies>root_direct_replies
  ), direct_participant_activity AS (
    SELECT reply.parent_id candidate_id,${activityAuthorIdentity} participant_id,
      max(reply.created_at) latest_reply_at FROM posts reply
      JOIN users activity_user ON activity_user.id=reply.user_id
      JOIN posts candidate ON candidate.id=reply.parent_id
      JOIN users candidate_user ON candidate_user.id=candidate.user_id
      WHERE reply.deleted_at IS NULL AND ${activityAuthorIdentity}!=${candidateAuthorIdentity}
      GROUP BY reply.parent_id,${activityAuthorIdentity}
  ), participant_recency AS (
    SELECT candidate_id,sum(pow(0.5,max(0,(julianday(?) - julianday(latest_reply_at))*24)
      /${recentParticipantActivityHalfLifeHours}.0)) participant_recency_score
      FROM direct_participant_activity GROUP BY candidate_id
  ), ranking_time(as_of) AS (VALUES(?)), scored AS (
    SELECT h.post_id,h.reply_count,h.activity_count,
      COALESCE(participant_recency.participant_recency_score,0) participant_recency_score,
      CASE WHEN branch_heads.head_id=h.post_id THEN 0 ELSE post_depth.depth END candidate_depth,
      max(0,(julianday(ranking_time.as_of)-julianday(p.created_at))*24) post_age_hours,
      max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24) reply_age_hours,
      pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
        /${recentReplyPriorityHalfLifeHours}) reply_recency_priority,
      h.score
      *CASE h.reply_count WHEN 1 THEN ${singleReplyParticipationWeight}
        WHEN 2 THEN ${twoReplyParticipationWeight} ELSE 1 END
      *pow(2,max(0,min(h.reply_count,${maxExponentiallyWeightedReplies})-${unboostedReplyCount})
        /${repliesPerDiscussionWeightDoubling})
      *pow(0.5,max(0,(julianday(ranking_time.as_of) - julianday(h.score_updated_at))*24)
        /${replyRecencyHalfLifeHours})
      *(1 + CASE WHEN h.reply_count > 0 THEN ${recentCommentBoost}.0
        *pow(0.5,max(0,(julianday(ranking_time.as_of) - julianday(h.latest_activity_at))*24)
          /${recentCommentBoostHalfLifeHours}) ELSE 0 END) recency_score,
      CASE WHEN h.reply_count >= ${discussionReserveReplyThreshold}
        AND (h.reply_count >= ${longLivedDiscussionReplyThreshold}
          OR max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
            <=${discussionParticipantReserveHours}) THEN
        min(${maxDiscussionReserve},max(${minimumDiscussionReserve},${discussionReserveScale}*pow(2,
          (min(h.reply_count,${maxExponentiallyWeightedReplies})-${discussionReserveReplyThreshold})
            /${repliesPerDiscussionWeightDoubling}))
          +CASE WHEN max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
            <=${discussionParticipantReserveHours} THEN
            ${recentDiscussionReserve}*pow(0.5,
              max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
                /${recentDiscussionReserveHalfLifeHours})
              +max(0,h.reply_count-${discussionReserveReplyThreshold})*${discussionParticipantReserveScale}
            ELSE 0 END
          +CASE WHEN h.reply_count>=${longLivedDiscussionReplyThreshold} THEN
            ${longDiscussionCommentScale}*pow(2,
              max(0,h.activity_count-${longDiscussionCommentThreshold})
                /${longDiscussionCommentsPerDoubling}) ELSE 0 END)
        ELSE 0 END discussion_reserve
      ,CASE WHEN h.reply_count=2 AND h.activity_count>=${conversationDepthThreshold} THEN
        min(${maxConversationDepthReserve},(h.activity_count-${conversationDepthThreshold}+1)
          *${conversationDepthScale})
        *pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
          /${conversationDepthHalfLifeHours}) ELSE 0 END conversation_depth_reserve
    FROM post_hot h JOIN posts p ON p.id=h.post_id JOIN post_depth ON post_depth.id=p.id
    LEFT JOIN branch_heads ON branch_heads.head_id=h.post_id CROSS JOIN ranking_time
    LEFT JOIN participant_recency ON participant_recency.candidate_id=h.post_id
  ), ranked_base AS (
    SELECT post_id,post_age_hours,reply_age_hours,reply_count,participant_recency_score,
      CASE WHEN candidate_depth=0 THEN 1 ELSE
        ${replyCandidateBaseWeight}*pow(${replyCandidateDepthWeight},candidate_depth-1) END candidate_weight,
      (CASE
      WHEN reply_count>=3 AND reply_age_hours<=${recentReplyPriorityHours} THEN
        1+reply_recency_priority+min(0.25,recency_score*0.01)
      WHEN reply_count=2 AND reply_age_hours<=${recentReplyPriorityHours} THEN
        0.225+reply_recency_priority*0.04
      WHEN reply_count>=3 THEN discussion_reserve
      ELSE max(recency_score,conversation_depth_reserve) END)
      *CASE WHEN candidate_depth=0 THEN 1 ELSE
        ${replyCandidateBaseWeight}*pow(${replyCandidateDepthWeight},candidate_depth-1) END base_score FROM scored
  ), ranked_unaged AS (
    SELECT post_id,reply_age_hours,
      (base_score*(1+${recentPostBoost}*max(0,1-post_age_hours/${recentPostBoostHours}.0))
      +candidate_weight*CASE WHEN base_score>0 AND reply_count>0 AND reply_age_hours<${recentReplyPriorityHours}
        THEN ${recentReplyActivityBoost}*CASE reply_count WHEN 1 THEN ${singleReplyRecentActivityWeight} ELSE 1 END
          *max(0,1-reply_age_hours/${recentReplyPriorityHours}.0) ELSE 0 END
      +candidate_weight*CASE WHEN base_score>0 AND reply_count>=3 THEN
        ${recentParticipantActivityWeight}*participant_recency_score ELSE 0 END
      +candidate_weight*CASE WHEN base_score>0 AND reply_count>1 AND post_age_hours<${recentPostBoostHours}
        THEN ${recentPostTierBonus}
        WHEN base_score>0 AND reply_count>1 AND post_age_hours<${yesterdayPostHours}
          AND reply_age_hours<=${recentReplyPriorityHours}
        THEN ${yesterdayPostTierBonus} ELSE 0 END
      +candidate_weight*CASE WHEN base_score>0 AND reply_count>=${discussionReserveReplyThreshold}
        AND reply_age_hours>=${recentReplyPriorityHours}
        AND reply_age_hours<${matureDiscussionLowTierHours} THEN ${matureDiscussionLowTierBonus} ELSE 0 END) hot_score
      FROM ranked_base
  ), ranked_raw AS (
    SELECT post_id,hot_score*CASE WHEN hot_score<1 THEN
      pow(0.5,reply_age_hours/${hotTailRecencyHalfLifeHours}.0) ELSE 1 END hot_score
    FROM ranked_unaged
  ), ranked_candidates AS (
    SELECT candidate.post_id,candidate.hot_score candidate_score FROM ranked_raw candidate
  ), ranked_tree(post_id,candidate_score,coverage_weight,depth) AS (
    SELECT candidate.post_id,candidate.candidate_score,1,0 FROM ranked_candidates candidate
    JOIN posts p ON p.id=candidate.post_id WHERE p.parent_id IS NULL
    UNION ALL
    SELECT child.id,candidate.candidate_score,ranked_tree.coverage_weight
      *CASE WHEN branch_heads.head_id=child.id THEN 1
        WHEN ranked_tree.candidate_score>=candidate.candidate_score THEN
        min(1,${replyRootCoverageScale}*candidate.candidate_score/ranked_tree.candidate_score) ELSE 1 END,
      ranked_tree.depth+1
    FROM ranked_tree JOIN posts child ON child.parent_id=ranked_tree.post_id
    JOIN ranked_candidates candidate ON candidate.post_id=child.id
    LEFT JOIN branch_heads ON branch_heads.head_id=child.id
  ), representative_scores AS (
    SELECT branch_heads.root_id,branch_heads.head_id,head.candidate_score head_score
    FROM branch_heads JOIN ranked_candidates head ON head.post_id=branch_heads.head_id
  ), ranked AS (
    SELECT ranked_tree.post_id,(candidate_score*coverage_weight
      +CASE WHEN candidate_score>0 THEN ${hotTailRecencyFloor}
        *pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)
          /${hotTailRecencyFloorHalfLifeHours}.0)
        *pow(${hotTailRecencyDepthWeight},ranked_tree.depth) ELSE 0 END)
      *CASE WHEN ranked_tree.depth=0 THEN pow(0.5,max(0,
        (julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24-${staleTailPostHours})
          /${staleTailPostHalfLifeHours}.0) ELSE 1 END
      *CASE WHEN ranked_tree.depth=0 AND h.reply_count<${discussionReserveReplyThreshold}
        AND (julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24>${recentReplyPriorityHours}
        THEN ${quietSmallDiscussionTailWeight} ELSE 1 END
      *CASE WHEN representative_scores.root_id=ranked_tree.post_id
        AND representative_scores.head_score>=candidate_score THEN
        min(1,${replyRootCoverageScale}*candidate_score/representative_scores.head_score) ELSE 1 END hot_score
    FROM ranked_tree JOIN post_hot h ON h.post_id=ranked_tree.post_id CROSS JOIN ranking_time
    LEFT JOIN representative_scores ON representative_scores.root_id=ranked_tree.post_id
  ) SELECT p.*,u.handle,ranked.hot_score,h.latest_activity_at,h.reply_count,h.activity_count
    FROM ranked JOIN post_hot h ON h.post_id=ranked.post_id
    JOIN posts p ON p.id=ranked.post_id JOIN users u ON u.id=p.user_id
    WHERE ${filters.join(' AND ')}
    ORDER BY ranked.hot_score ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      h.latest_activity_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.created_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(timestamp, ...parameters) as HotPost[]
  return cursor?.direction === 'previous' ? rows.reverse() : rows
}
