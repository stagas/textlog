import type { Database } from 'bun:sqlite'
import { withoutMarkdownCode } from './content'
import { recordHotActivity } from './hot'
import type { PollView } from './types'

export const POLL_LIFETIME_MS = 24 * 60 * 60 * 1000

export type PollDefinition = { question: string; options: string[]; kind?: 'quiz'; correctIndex?: number;
  explanation?: string }

function pollsAvailable(database: Database) {
  return !!database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'poll_options\'').get()
}

export function parsePoll(body: string): PollDefinition | null {
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => /(?:^|\s)#(?:poll|quiz)\s*$/i.test(line))
  if (marker < 0) return null
  const markerLine = lines[marker]
  const markerMatch = markerLine.match(/#(poll|quiz)\s*$/i)!
  const kind = markerMatch[1].toLowerCase() as 'poll' | 'quiz'
  const markerStart = markerMatch.index!
  const question = [...lines.slice(0, marker), markerLine.slice(0, markerStart)].join('\n').trim()
  const remainingLines = lines.slice(marker + 1)
  const separator = kind === 'quiz' ? remainingLines.findIndex(line => !line.trim()) : -1
  const answerLines = (separator < 0 ? remainingLines : remainingLines.slice(0, separator))
    .map(option => option.trim()).filter(Boolean)
  const explanation = separator < 0 ? '' : remainingLines.slice(separator + 1).join('\n').trim()
  const correct = answerLines.map(option => kind === 'quiz' && /^>\s+/.test(option))
  const options = answerLines.map(option => kind === 'quiz' ? option.replace(/^>\s+/, '').trim() : option)
  if (!question || options.length < 2 || options.length > 8 || new Set(options).size !== options.length) return null
  if (kind === 'quiz' && correct.filter(Boolean).length !== 1) return null
  return { question, options,
    ...(kind === 'quiz' ? { kind, correctIndex: correct.indexOf(true), ...(explanation ? { explanation } : {}) } : {}) }
}

export function pollDisplayBody(body: string) {
  const poll = parsePoll(body)
  if (!poll) return body
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => /(?:^|\s)#(?:poll|quiz)\s*$/i.test(line))
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

export function loadPolls(database: Database, postIds: number[], viewerId: number): Map<number, PollView> {
  if (!postIds.length || !pollsAvailable(database)) return new Map<number, PollView>()
  const placeholders = postIds.map(() => '?').join(',')
  const rows = database.query(`SELECT o.post_id,o.id,o.position,o.label,count(v.user_id) votes,
      max(CASE WHEN v.user_id=? THEN 1 ELSE 0 END) selected
    FROM poll_options o LEFT JOIN poll_votes v ON v.option_id=o.id
    WHERE o.post_id IN (${placeholders}) GROUP BY o.id ORDER BY o.post_id,o.position`)
    .all(viewerId, ...postIds) as Array<
      { post_id: number; id: number; position: number; label: string; votes: number; selected: number }
    >
  const created = database.query(`SELECT id,created_at,body FROM posts WHERE id IN (${placeholders})`)
    .all(...postIds) as Array<{ id: number; created_at: string; body: string }>
  const createdById = new Map(created.map(row => [row.id, row.created_at]))
  const definitionsById = new Map(created.map(row => [row.id, parsePoll(row.body)]))
  const optionsByPost = new Map<number, PollView['options']>()
  for (const row of rows) {
    const options = optionsByPost.get(row.post_id) || []
    options.push({ id: row.id, label: row.label, votes: row.votes, selected: !!row.selected })
    optionsByPost.set(row.post_id, options)
  }
  return new Map([...optionsByPost].map(([postId, options]) => {
    const createdAt = createdById.get(postId)!
    const definition = definitionsById.get(postId)
    const kind: NonNullable<PollView['kind']> = definition?.kind || 'poll'
    const correctIndex = definition?.correctIndex
    const expiresAt = kind === 'quiz'
      ? null
      : Date.parse(createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z')) + POLL_LIFETIME_MS
    const totalVotes = options.reduce((sum, option) => sum + option.votes, 0)
    return [postId, {
      options: options.map((option, index) => ({ ...option,
        correct: kind === 'quiz' ? index === correctIndex : undefined })
      ),
      kind,
      totalVotes,
      expired: expiresAt !== null && Date.now() >= expiresAt,
      expiresAt,
      viewerVoted: options.some(option => option.selected),
      explanation: definition?.explanation,
    }]
  }))
}

export function voteInPoll(database: Database, postId: number, optionId: number, userId: number) {
  if (!pollsAvailable(database)) return 'not_found' as const
  const option = database.query(`SELECT o.id,p.created_at,p.body FROM poll_options o JOIN posts p ON p.id=o.post_id
    WHERE o.id=? AND o.post_id=? AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
        WHERE ph.post_id=p.id AND bh.user_id=?)`).get(optionId, postId, userId, userId, userId) as { id: number;
    created_at: string; body: string } | null
  if (!option) return 'not_found' as const
  const createdAt = Date.parse(option.created_at.replace(' ', 'T') + (option.created_at.endsWith('Z') ? '' : 'Z'))
  if (parsePoll(option.body)?.kind !== 'quiz' && Date.now() >= createdAt + POLL_LIFETIME_MS) return 'expired' as const
  const changed = database.query('INSERT OR IGNORE INTO poll_votes(post_id,option_id,user_id) VALUES(?,?,?)')
    .run(postId, optionId, userId).changes
  if (changed) recordHotActivity(database, postId)
  if (changed && database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'feed_snapshot_generation\'',
  ).get()) database.query('UPDATE feed_snapshot_generation SET generation=generation+1 WHERE id=1').run()
  return changed ? 'ready' as const : 'already_voted' as const
}
