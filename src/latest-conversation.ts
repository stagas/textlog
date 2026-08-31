const LATEST_MIN_RECENT_REPLIES = 4
const LATEST_MAX_RECENT_REPLIES = 5
const LATEST_REPLY_BURST_HOURS = 48
const LATEST_REPLY_BURST_MS = LATEST_REPLY_BURST_HOURS * 60 * 60_000

type ConversationPost = { id: number; parent_id: number | null; created_at: string }

const timestamp = (createdAt: string) => Date.parse(`${createdAt.replace(' ', 'T')}Z`)

const newestFirst = <T extends ConversationPost>(conversation: T[]) => [...conversation]
  .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)

const withinReplyBurst = <T extends ConversationPost>(newest: T | undefined, post: T) => {
  const newestAt = newest ? timestamp(newest.created_at) : Number.NaN
  const postAt = timestamp(post.created_at)
  return Number.isFinite(newestAt) && Number.isFinite(postAt) && newestAt - postAt <= LATEST_REPLY_BURST_MS
}

const recentReplyCandidates = <T extends ConversationPost>(ordered: T[]) => {
  const replies = ordered.filter(row => row.parent_id !== null)
  return replies.slice(0, LATEST_MAX_RECENT_REPLIES)
    .filter((reply, index) => index < LATEST_MIN_RECENT_REPLIES || withinReplyBurst(replies[0], reply))
}

const recentRoot = <T extends ConversationPost>(root: T | undefined, newest: T | undefined) => root
  && root.parent_id === null && newest && withinReplyBurst(newest, root)

const rootedReplies = <T extends ConversationPost>(ordered: T[], root: T, recent: T[]) => {
  const weighted = recent.slice(0, 4)
  const weightedIds = new Set(weighted.map(reply => reply.id))
  const selected = ordered.filter(reply => weightedIds.has(reply.id))
  const selectedIds = new Set([root.id, ...selected.map(reply => reply.id)])
  const missingParentId = selected.find(reply => reply.parent_id !== null && !selectedIds.has(reply.parent_id))?.parent_id
  if (missingParentId != null) {
    const missingParent = ordered.find(reply => reply.id === missingParentId && reply.parent_id !== null)
    if (missingParent) selected.push(missingParent)
  }
  else {
    const connectedOlderReply = ordered.find(reply => reply.parent_id !== null
      && !selectedIds.has(reply.id) && selectedIds.has(reply.parent_id))
    if (connectedOlderReply) selected.push(connectedOlderReply)
  }
  return selected
}

/** Keep the fresh context on the branch that caused an old conversation to resurface. */
const activeBranchReplies = <T extends ConversationPost>(ordered: T[], root: T | undefined, recent: T[]) => {
  const newest = recent[0]
  if (!newest || !root || newest.parent_id === root.id) return recent
  const byId = new Map(ordered.map(post => [post.id, post]))
  const fresh = recent.filter(post => withinReplyBurst(newest, post))
  const strictAncestors = (post: T) => {
    const ancestors: T[] = []
    let parentId = post.parent_id
    while (parentId !== null) {
      const parent = byId.get(parentId)
      if (!parent) break
      ancestors.push(parent)
      parentId = parent.parent_id
    }
    return ancestors
  }
  const ancestorPaths = fresh.map(strictAncestors)
  const sharedIds = new Set(ancestorPaths[0]?.map(post => post.id) || [])
  for (const path of ancestorPaths.slice(1)) {
    const pathIds = new Set(path.map(post => post.id))
    for (const id of sharedIds) if (!pathIds.has(id)) sharedIds.delete(id)
  }
  const anchor = ancestorPaths[0]?.find(post => sharedIds.has(post.id))
  return anchor && !fresh.some(post => post.id === anchor.id) ? [...fresh, anchor] : fresh
}

/**
 * Make the single recent-conversation decision used by every threaded feed.
 * Unread replies are deliberately not handled here: callers append every unread row after this projection.
 */
export function projectRecentConversation<T extends ConversationPost>(
  conversation: T[],
  { forceRoot = false }: { forceRoot?: boolean } = {},
) {
  const ordered = newestFirst(conversation)
  const root = ordered.find(post => post.parent_id === null)
  const recent = recentReplyCandidates(ordered)
  const newest = recent[0]
  const recentDirectReplies = root ? recent.filter(reply => reply.parent_id === root.id) : []
  const freshDirectReplies = recentDirectReplies.filter(reply => withinReplyBurst(newest, reply))
  const keepsRoot = !!root && (forceRoot || ordered[0]?.id === root.id || newest?.parent_id === root.id
    || freshDirectReplies.length > 0 || !!recentRoot(root, newest))
  const replies = root && keepsRoot
    ? rootedReplies(ordered, root, recent)
    : activeBranchReplies(ordered, root, recent)
  const replyIds = new Set(replies.map(reply => reply.id))
  const weightedDirectReplies = freshDirectReplies.filter(reply => replyIds.has(reply.id)).slice(0, 2)
  const weightedReplyIds = new Set(weightedDirectReplies.map(reply => reply.id))
  const weightedCandidates = [...weightedDirectReplies,
    ...replies.filter(reply => !weightedReplyIds.has(reply.id))]
  const previewCount = weightedCandidates.length > 1 && withinReplyBurst(newest, weightedCandidates[1]) ? 2 : 1
  const previewIds = new Set(weightedCandidates.slice(0, previewCount).map(reply => reply.id))
  const previewReplies = replies.filter(reply => previewIds.has(reply.id))
  return { root, keepsRoot, replies, previewReplyIds: new Set(previewReplies.map(reply => reply.id)) }
}

/** Select posts visible while a projected conversation is folded. */
export function collapsedConversationPreview<T extends ConversationPost & { feed_collapsed_preview?: boolean }>(
  replies: T[],
  unreadPostIds?: ReadonlySet<number>,
) {
  const ordered = newestFirst(replies)
  const projectedPreview = ordered.filter(post => post.feed_collapsed_preview)
  const weighted = projectedPreview.length
    ? projectedPreview
    : ordered.length > 1 && withinReplyBurst(ordered[0], ordered[1])
    ? ordered.slice(0, 2)
    : ordered.slice(0, 1)
  const previewIds = new Set(weighted.map(post => post.id))
  return [...weighted, ...ordered.filter(post => unreadPostIds?.has(post.id) && !previewIds.has(post.id))]
}
