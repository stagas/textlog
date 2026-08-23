import type { Database } from 'bun:sqlite'
import type { PollView } from './types'
import { recordHotActivity } from './hot'
import { withoutMarkdownCode } from './content'

export const POLL_LIFETIME_MS = 24 * 60 * 60 * 1000

export type PollDefinition = { question: string; options: string[] }

function pollsAvailable(database: Database) {
  return !!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='poll_options'").get()
}

export function parsePoll(body: string): PollDefinition | null {
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => /(?:^|\s)#poll\s*$/i.test(line))
  if (marker < 0) return null
  const markerLine = lines[marker]
  const markerStart = markerLine.toLowerCase().lastIndexOf('#poll')
  const question = [...lines.slice(0, marker), markerLine.slice(0, markerStart)].join('\n').trim()
  const options = lines.slice(marker + 1).map(option => option.trim()).filter(Boolean)
  if (!question || options.length < 2 || options.length > 8 || new Set(options).size !== options.length) return null
  return { question, options }
}

export function pollDisplayBody(body: string) {
  const poll = parsePoll(body)
  if (!poll) return body
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => /(?:^|\s)#poll\s*$/i.test(line))
  return lines.slice(0, marker + 1).join('\n').trim()
}

export function syncPoll(database: Database, postId: number, body: string) {
  if (!pollsAvailable(database)) return
  const poll = parsePoll(body)
  const existing = database.query('SELECT label FROM poll_options WHERE post_id=? ORDER BY position')
    .all(postId) as { label: string }[]
  if (poll && existing.length === poll.options.length
    && existing.every((option, index) => option.label === poll.options[index])) return
  database.query('DELETE FROM poll_votes WHERE post_id=?').run(postId)
  database.query('DELETE FROM poll_options WHERE post_id=?').run(postId)
  if (!poll) return
  const insert = database.query('INSERT INTO poll_options(post_id,position,label) VALUES(?,?,?)')
  poll.options.forEach((label, position) => insert.run(postId, position, label))
}

export function loadPolls(database: Database, postIds: number[], viewerId: number) {
  if (!postIds.length || !pollsAvailable(database)) return new Map<number, PollView>()
  const placeholders = postIds.map(() => '?').join(',')
  const rows = database.query(`SELECT o.post_id,o.id,o.position,o.label,count(v.user_id) votes,
      max(CASE WHEN v.user_id=? THEN 1 ELSE 0 END) selected
    FROM poll_options o LEFT JOIN poll_votes v ON v.option_id=o.id
    WHERE o.post_id IN (${placeholders}) GROUP BY o.id ORDER BY o.post_id,o.position`)
    .all(viewerId, ...postIds) as Array<{ post_id: number; id: number; position: number; label: string;
      votes: number; selected: number }>
  const created = database.query(`SELECT id,created_at FROM posts WHERE id IN (${placeholders})`)
    .all(...postIds) as Array<{ id: number; created_at: string }>
  const createdById = new Map(created.map(row => [row.id, row.created_at]))
  const optionsByPost = new Map<number, PollView['options']>()
  for (const row of rows) {
    const options = optionsByPost.get(row.post_id) || []
    options.push({ id: row.id, label: row.label, votes: row.votes, selected: !!row.selected })
    optionsByPost.set(row.post_id, options)
  }
  return new Map([...optionsByPost].map(([postId, options]) => {
    const createdAt = createdById.get(postId)!
    const expiresAt = Date.parse(createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z')) + POLL_LIFETIME_MS
    const totalVotes = options.reduce((sum, option) => sum + option.votes, 0)
    return [postId, { options, totalVotes, expired: Date.now() >= expiresAt, expiresAt,
      viewerVoted: options.some(option => option.selected) }]
  }))
}

export function voteInPoll(database: Database, postId: number, optionId: number, userId: number) {
  if (!pollsAvailable(database)) return 'not_found' as const
  const option = database.query(`SELECT o.id,p.created_at FROM poll_options o JOIN posts p ON p.id=o.post_id
    WHERE o.id=? AND o.post_id=? AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)`).get(optionId, postId, userId, userId, userId) as
      { id: number; created_at: string } | null
  if (!option) return 'not_found' as const
  const createdAt = Date.parse(option.created_at.replace(' ', 'T') + (option.created_at.endsWith('Z') ? '' : 'Z'))
  if (Date.now() >= createdAt + POLL_LIFETIME_MS) return 'expired' as const
  const changed = database.query('INSERT OR IGNORE INTO poll_votes(post_id,option_id,user_id) VALUES(?,?,?)')
    .run(postId, optionId, userId).changes
  if (changed) recordHotActivity(database, postId)
  if (changed && database.query(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='feed_snapshot_generation'",
  ).get()) database.query('UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1').run()
  return changed ? 'ready' as const : 'already_voted' as const
}
