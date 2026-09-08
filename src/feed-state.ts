import type { Database } from 'bun:sqlite'

export type PersonalizedFeedKind = 'for-you' | 'to-me'

export type PersonalizedFeedState = {
  last_seen_sequence: number
  latest_sequence: number
  unread_count: number
}

export type MaterializedFeedEntry = {
  sequence: number
  event_key: string
  event_kind: string
  source_post_id: number | null
  actor_id: number | null
  target_user_id: number | null
  target_tag: string | null
  reason: number
  created_at: string
  eligible: number
}

export function personalizedFeedState(database: Database, viewerId: number, feed: PersonalizedFeedKind) {
  return database.query(`SELECT last_seen_sequence,latest_sequence,unread_count FROM feed_state
    WHERE viewer_id=? AND feed=?`).get(viewerId, feed) as PersonalizedFeedState | null
}

/** Advance only through an entry that was actually returned to the viewer. */
export function markPersonalizedFeedThrough(database: Database, viewerId: number, feed: PersonalizedFeedKind,
  representedSequence: number)
{
  const reads = feed === 'to-me' ? 'to_me_reads' : 'for_you_reads'
  database.query(`UPDATE feed_state SET last_seen_sequence=max(last_seen_sequence,?),
    unread_count=(SELECT count(*) FROM personalized_feed_entries
      WHERE viewer_id=? AND feed=? AND sequence>max(feed_state.last_seen_sequence,?) AND eligible=1
        AND NOT EXISTS(SELECT 1 FROM ${reads} seen
          WHERE seen.user_id=personalized_feed_entries.viewer_id
            AND seen.event_key=personalized_feed_entries.event_key)
        AND (feed!='for-you' OR event_kind!='user_follow' OR
          coalesce((SELECT hide_people_follow_activity FROM users WHERE id=viewer_id),0)=0)
        AND (feed!='for-you' OR event_kind!='tag_follow' OR
          coalesce((SELECT hide_hashtag_follow_activity FROM users WHERE id=viewer_id),0)=0))
    WHERE viewer_id=? AND feed=?`).run(
    representedSequence, viewerId, feed, representedSequence, viewerId, feed,
  )
}

export function personalizedFeedUnreadCount(database: Database, viewerId: number, feed: PersonalizedFeedKind) {
  return personalizedFeedState(database, viewerId, feed)?.unread_count ?? 0
}

export function refreshPersonalizedFeedState(database: Database, viewerId: number, feed: PersonalizedFeedKind) {
  const reads = feed === 'to-me' ? 'to_me_reads' : 'for_you_reads'
  database.query(`UPDATE feed_state SET
    latest_sequence=coalesce((SELECT max(sequence) FROM personalized_feed_entries
      WHERE viewer_id=? AND feed=?),0),
    unread_count=(SELECT count(*) FROM personalized_feed_entries entry
      WHERE entry.viewer_id=? AND entry.feed=? AND entry.eligible=1 AND NOT EXISTS
        (SELECT 1 FROM ${reads} seen WHERE seen.user_id=? AND seen.event_key=entry.event_key)
        AND (entry.feed!='for-you' OR entry.event_kind!='user_follow' OR
          coalesce((SELECT hide_people_follow_activity FROM users WHERE id=entry.viewer_id),0)=0)
        AND (entry.feed!='for-you' OR entry.event_kind!='tag_follow' OR
          coalesce((SELECT hide_hashtag_follow_activity FROM users WHERE id=entry.viewer_id),0)=0))
    WHERE viewer_id=? AND feed=?`).run(viewerId, feed, viewerId, feed, viewerId, viewerId, feed)
}

/** Resolve numbered navigation as a chain of keyset boundaries, never an OFFSET scan. */
export function materializedPersonalizedEventPage(database: Database, viewerId: number, feed: PersonalizedFeedKind,
  page: number, pageSize: number, generation: number)
{
  const requestedPage = Math.max(1, Math.floor(page))
  const limit = Math.max(1, Math.floor(pageSize))
  const cursor = database.query(`SELECT before_sequence FROM personalized_feed_page_cursors
    WHERE viewer_id=? AND feed=? AND page_size=? AND page=? AND generation=?`)
  const putCursor = database.query(`INSERT INTO personalized_feed_page_cursors(
    viewer_id,feed,page_size,page,before_sequence,generation) VALUES(?,?,?,?,?,?)
    ON CONFLICT(viewer_id,feed,page_size,page) DO UPDATE SET
      before_sequence=excluded.before_sequence,generation=excluded.generation`)
  putCursor.run(viewerId, feed, limit, 1, null, generation)
  let currentPage = 1
  let before: number | null = null
  const saved = cursor.get(viewerId, feed, limit, requestedPage, generation) as {
    before_sequence: number | null
  } | null
  if (saved) {
    currentPage = requestedPage
    before = saved.before_sequence
  }
  while (currentPage < requestedPage) {
    const boundaryRows = database.query(`SELECT sequence FROM personalized_feed_entries
      WHERE viewer_id=? AND feed=? AND eligible=1 AND (? IS NULL OR sequence<?)
      ORDER BY sequence DESC LIMIT ?`).all(viewerId, feed, before, before, limit) as Array<{ sequence: number }>
    const boundary = boundaryRows.at(-1)
    if (!boundary) return { entries: [] as MaterializedFeedEntry[], page: currentPage, hasNext: false }
    before = boundary.sequence
    currentPage++
    putCursor.run(viewerId, feed, limit, currentPage, before, generation)
  }
  const entries = database.query(`SELECT sequence,event_key,event_kind,source_post_id,actor_id,target_user_id,
    target_tag,reason,created_at,eligible FROM personalized_feed_entries
    WHERE viewer_id=? AND feed=? AND eligible=1 AND (? IS NULL OR sequence<?)
    ORDER BY sequence DESC LIMIT ?`).all(viewerId, feed, before, before, limit + 1) as MaterializedFeedEntry[]
  const hasNext = entries.length > limit
  const visible = entries.slice(0, limit)
  if (hasNext && visible.length) putCursor.run(viewerId, feed, limit, currentPage + 1,
    visible[visible.length - 1].sequence, generation)
  return { entries: visible, page: currentPage, hasNext }
}

export function materializedPersonalizedGroupPage(database: Database, viewerId: number, feed: PersonalizedFeedKind,
  page: number, pageSize: number, generation: number)
{
  const limit = Math.max(1, Math.floor(pageSize))
  const visibleGroup = `AND NOT EXISTS(SELECT 1 FROM personalized_feed_entries hidden
    JOIN users viewer ON viewer.id=hidden.viewer_id
    WHERE hidden.sequence=personalized_feed_groups.latest_sequence
      AND personalized_feed_groups.feed='for-you'
      AND ((hidden.event_kind='user_follow' AND viewer.hide_people_follow_activity=1)
        OR (hidden.event_kind='tag_follow' AND viewer.hide_hashtag_follow_activity=1)))`
  const totalItems = (database.query(`SELECT count(*) count FROM personalized_feed_groups
    WHERE viewer_id=? AND feed=? ${visibleGroup}`).get(viewerId, feed) as { count: number }).count
  const totalPages = Math.max(1, Math.ceil(totalItems / limit))
  const requestedPage = Math.min(Math.max(1, Math.floor(page)), totalPages)
  const cursor = database.query(`SELECT before_sequence FROM personalized_feed_group_cursors
    WHERE viewer_id=? AND feed=? AND page_size=? AND page=? AND generation=?`)
  const put = database.query(`INSERT INTO personalized_feed_group_cursors(
    viewer_id,feed,page_size,page,before_sequence,generation) VALUES(?,?,?,?,?,?)
    ON CONFLICT(viewer_id,feed,page_size,page) DO UPDATE SET
      before_sequence=excluded.before_sequence,generation=excluded.generation`)
  put.run(viewerId, feed, limit, 1, null, generation)
  let currentPage = 1
  let before: number | null = null
  const saved = cursor.get(viewerId, feed, limit, requestedPage, generation) as {
    before_sequence: number | null
  } | null
  if (saved) {
    currentPage = requestedPage
    before = saved.before_sequence
  }
  while (currentPage < requestedPage) {
    const rows = database.query(`SELECT latest_sequence FROM personalized_feed_groups
      WHERE viewer_id=? AND feed=? AND (? IS NULL OR latest_sequence<?)
        ${visibleGroup}
      ORDER BY latest_sequence DESC,group_key DESC LIMIT ?`).all(
      viewerId, feed, before, before, limit,
    ) as Array<{ latest_sequence: number }>
    const boundary = rows.at(-1)
    if (!boundary) return { groups: [] as string[], page: currentPage, totalItems: 0, totalPages: 1 }
    before = boundary.latest_sequence
    currentPage++
    put.run(viewerId, feed, limit, currentPage, before, generation)
  }
  const rows = database.query(`SELECT group_key,latest_sequence FROM personalized_feed_groups
    WHERE viewer_id=? AND feed=? AND (? IS NULL OR latest_sequence<?)
      ${visibleGroup}
    ORDER BY latest_sequence DESC,group_key DESC LIMIT ?`).all(viewerId, feed, before, before, limit + 1) as Array<{
      group_key: string
      latest_sequence: number
    }>
  if (rows.length > limit) put.run(viewerId, feed, limit, currentPage + 1, rows[limit - 1].latest_sequence, generation)
  return { groups: rows.slice(0, limit).map(row => row.group_key), page: currentPage, totalItems,
    totalPages }
}
