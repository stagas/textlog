import type { Database } from 'bun:sqlite'
import { META_HASHTAGS } from './meta-thread'
import { excludesWhisperPosts } from './whisper'

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

export const hotRankingVersion = 124
const cursorVersion = hotRankingVersion
const activityHalfLifeHours = 6
const postWeight = 0
const directReplyWeight = 2
const pollVoteWeight = 2
const metaPostHotMultiplier = 0.5

function hasHotTable(database: Database) {
  return Boolean(database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_hot\'').get())
}

export function hotScoresNeedRebuild(database: Database) {
  if (!hasHotTable(database)) return false
  return !!database.query(`SELECT 1 FROM posts p LEFT JOIN post_hot h ON h.post_id=p.id
    WHERE h.post_id IS NULL LIMIT 1`).get()
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
  return Boolean(database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'poll_votes\'').get())
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

export function refreshHotFeedProjection(database: Database, now = new Date()) {
  if (!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'hot_feed_projection\'').get()) {
    return { conversations: 0, posts: 0 }
  }
  const tracksGeneration = (database.query('PRAGMA table_info(hot_feed_projection_state)').all() as Array<{
    name: string
  }>).some(column => column.name === 'generation')
  const generation = tracksGeneration
    ? (database.query('SELECT generation FROM hot_feed_projection_state WHERE id=1').get() as {
      generation: number
    }).generation
    : 0
  const ranked = getHotPosts(database, 1_000_000, null, now, -1, false, 2, false)
  const roots = ranked.length
    ? database.query(`SELECT pc.post_id,pc.conversation_id FROM post_conversations pc
    WHERE pc.post_id IN (${ranked.map(() => '?').join(',')})`).all(...ranked.map(post => post.id)) as Array<{
      post_id: number
      conversation_id: number
    }>
    : []
  const conversationByPost = new Map(roots.map(row => [row.post_id, row.conversation_id]))
  const conversationRanks = new Map<number, number>()
  const rows = ranked.map((post, rank) => {
    const conversationId = conversationByPost.get(post.id) || post.id
    if (!conversationRanks.has(conversationId)) conversationRanks.set(conversationId, conversationRanks.size)
    return { post, rank, conversationId, conversationRank: conversationRanks.get(conversationId)! }
  })
  database.transaction(() => {
    database.query('DELETE FROM hot_feed_projection').run()
    const insert = database.query(`INSERT INTO hot_feed_projection(
      post_id,conversation_id,conversation_rank,post_rank,hot_score,latest_activity_at
    ) VALUES(?,?,?,?,?,?)`)
    for (const row of rows) {
      insert.run(row.post.id, row.conversationId, row.conversationRank, row.rank, row.post.hot_score,
        row.post.latest_activity_at)
    }
    if (tracksGeneration) {
      database.query(`UPDATE hot_feed_projection_state SET
        dirty=CASE WHEN generation=? THEN 0 ELSE 1 END,ranking_version=?,refreshed_at=? WHERE id=1`)
        .run(generation, hotRankingVersion, now.toISOString())
    }
    else {database.query(`UPDATE hot_feed_projection_state SET dirty=0,ranking_version=?,refreshed_at=? WHERE id=1`)
        .run(hotRankingVersion, now.toISOString())}
  })()
  return { conversations: conversationRanks.size, posts: rows.length }
}

export function hotFeedProjectionNeedsRefresh(database: Database, now = Date.now(), maxAgeMs = 5 * 60_000) {
  const state = database.query(`SELECT dirty,ranking_version,refreshed_at
    FROM hot_feed_projection_state WHERE id=1`).get() as {
    dirty: number
    ranking_version: number
    refreshed_at: string | null
  } | null
  return !state || !!state.dirty || state.ranking_version !== hotRankingVersion || !state.refreshed_at
    || now - Date.parse(state.refreshed_at) >= maxAgeMs
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
        AND ${excludesWhisperPosts('descendants.id')}
        AND ${replyIdentity}!=${candidateIdentity}
    ), activity(candidate_id,created_at,weight,is_reply) AS (
      SELECT id,created_at,${postWeight},0 FROM posts WHERE deleted_at IS NULL
      UNION ALL
      SELECT candidate_id,created_at,${directReplyWeight}*pow(0.5,depth-1),1
      FROM ranked_replies WHERE reply_rank=1
      ${
        tracksPollVotes
          ? `UNION ALL
      SELECT votes.post_id,votes.created_at,${pollVoteWeight},0 FROM poll_votes votes
      JOIN posts voted_post ON voted_post.id=votes.post_id WHERE voted_post.deleted_at IS NULL`
          : ''
      }
    ), recency_replies AS (
      SELECT descendants.candidate_id,descendants.created_at FROM descendants
      JOIN posts candidate ON candidate.id=descendants.candidate_id
      LEFT JOIN users reply_user ON reply_user.id=descendants.user_id
      JOIN users candidate_user ON candidate_user.id=candidate.user_id
      WHERE descendants.deleted_at IS NULL
        AND ${excludesWhisperPosts('descendants.id')}
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
      WHERE descendants.deleted_at IS NULL
        AND ${excludesWhisperPosts('descendants.id')}
        AND ${replyIdentity}!=${candidateIdentity}
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
      AND ${excludesWhisperPosts('descendants.id')}
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
      AND ${excludesWhisperPosts('descendants.id')}
    ${
    tracksPollVotes
      ? `UNION ALL
    SELECT votes.option_id,votes.created_at,${pollVoteWeight},1,0 FROM poll_votes votes
    WHERE votes.post_id=?`
      : ''
  }
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
  bypassBlocks = false,
) {
  const timestamp = cursor?.asOf || (asOf instanceof Date ? asOf.toISOString() : asOf)
  const filters = ['p.deleted_at IS NULL', 'p.parent_id IS NULL', excludesWhisperPosts(), 'ranked.hot_score > 0']
  const parameters: Array<string | number> = [timestamp]

  if (viewerId >= 0 && !bypassBlocks) {
    filters.push(`NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    parameters.push(viewerId, viewerId)
  }
  if (viewerId >= 0) {
    filters.push(`NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`)
    parameters.push(viewerId)
  }
  if (publicOnly) filters.push('u.deleted_at IS NULL')
  if (minimumDiscussionReplies > 0) {
    filters.push('(h.reply_count>=1 OR COALESCE(polls.vote_count,0)>=?)')
    parameters.push(minimumDiscussionReplies)
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

  const pollCounts = hasPollVotes(database)
    ? 'SELECT post_id,count(*) vote_count,max(created_at) latest_vote_at FROM poll_votes GROUP BY post_id'
    : 'SELECT NULL post_id,0 vote_count,NULL latest_vote_at WHERE 0'
  const rows = database.query(`WITH poll_counts AS (${pollCounts}), ranking_time(as_of) AS (VALUES(?)),
    scored AS (
      SELECT h.post_id,CASE WHEN h.reply_count=0 AND h.activity_count=0
        AND COALESCE(poll_counts.vote_count,0)=0 THEN 0 ELSE
        (12.0*log(1+h.reply_count)/log(2)
          +3.0*log(1+h.activity_count)/log(2)
          +2.0*min(h.reply_count,12)
          +CASE WHEN COALESCE(poll_counts.vote_count,0)>0 THEN
            8.0*log(1+min(poll_counts.vote_count,10))/log(2)
              *pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(poll_counts.latest_vote_at))*24)/24.0)
            ELSE 0 END
          +CASE WHEN h.reply_count>0 OR h.activity_count>0 THEN min(4,h.score) ELSE 0 END
          +6.0*log(1+h.reply_count)/log(2)*pow(0.5,max(0,
            (julianday(h.latest_activity_at)-julianday(p.created_at))*24)/24.0)
          +20.0*pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(p.created_at))*24)/72.0)
          +10.0*pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(h.latest_activity_at))*24)/48.0))
        *(0.45+0.55*pow(0.5,max(0,(julianday(ranking_time.as_of)-julianday(p.created_at))*24)/504.0))
        *CASE WHEN COALESCE(poll_counts.vote_count,0)>0 THEN
          0.2+0.8*pow(0.5,max(0,
            (julianday(ranking_time.as_of)-julianday(poll_counts.latest_vote_at))*24)/24.0)
          ELSE 1 END
        *CASE WHEN EXISTS (SELECT 1 FROM post_hashtags meta_tag WHERE meta_tag.post_id=p.id
          AND meta_tag.tag IN (${META_HASHTAGS.map(tag => `'${tag}'`).join(',')}))
          THEN ${metaPostHotMultiplier} ELSE 1 END END hot_score
      FROM post_hot h JOIN posts p ON p.id=h.post_id CROSS JOIN ranking_time
      LEFT JOIN poll_counts ON poll_counts.post_id=h.post_id
      WHERE p.parent_id IS NULL
    ), recent_leader AS (
      SELECT scored.post_id FROM scored JOIN posts p ON p.id=scored.post_id
      WHERE scored.hot_score>0 AND p.deleted_at IS NULL AND ${excludesWhisperPosts()}
        AND max(0,(julianday((SELECT as_of FROM ranking_time))-julianday(p.created_at))*24)<=48
      ORDER BY scored.hot_score DESC,p.created_at DESC,p.id DESC LIMIT 1
    ), score_ceiling AS (SELECT COALESCE(max(hot_score),0) hot_score FROM scored), ranked AS (
      SELECT scored.post_id,CASE WHEN recent_leader.post_id=scored.post_id
        THEN score_ceiling.hot_score+1 ELSE scored.hot_score END hot_score
      FROM scored CROSS JOIN score_ceiling LEFT JOIN recent_leader ON recent_leader.post_id=scored.post_id
    )
    SELECT p.*,u.handle,ranked.hot_score,h.latest_activity_at,h.reply_count,h.activity_count
    FROM ranked JOIN post_hot h ON h.post_id=ranked.post_id
    JOIN posts p ON p.id=ranked.post_id JOIN users u ON u.id=p.user_id
    LEFT JOIN poll_counts polls ON polls.post_id=p.id
    WHERE ${filters.join(' AND ')}
    ORDER BY ranked.hot_score ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      h.latest_activity_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.created_at ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'},
      p.id ${cursor?.direction === 'previous' ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...parameters) as HotPost[]
  return cursor?.direction === 'previous' ? rows.reverse() : rows
}
