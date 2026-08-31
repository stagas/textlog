const LATEST_MIN_RECENT_REPLIES = 4
const LATEST_UNPRUNED_RECENT_REPLIES = 2
const LATEST_MAX_RECENT_REPLIES = 5
const LATEST_REPLY_BURST_HOURS = 48

export function isRecentConversationRoot<T extends { parent_id: number | null; created_at: string }>(
  root: T | undefined,
  conversation: T[],
) {
  if (!root || root.parent_id !== null || !conversation[0]) return false
  const newestAt = Date.parse(`${conversation[0].created_at.replace(' ', 'T')}Z`)
  const rootAt = Date.parse(`${root.created_at.replace(' ', 'T')}Z`)
  return Number.isFinite(newestAt) && Number.isFinite(rootAt)
    && newestAt - rootAt <= LATEST_REPLY_BURST_HOURS * 60 * 60_000
}

export function recentConversationReplies<T extends { id: number; parent_id: number | null; created_at: string }>(
  conversation: T[],
  keepAncestorChain = false,
) {
  const replies = conversation.filter(row => row.parent_id !== null)
  const newestReplyAt = replies[0]
    ? Date.parse(`${replies[0].created_at.replace(' ', 'T')}Z`)
    : Number.NaN
  const recent = replies.slice(0, LATEST_MAX_RECENT_REPLIES).filter((reply, index) => index < LATEST_MIN_RECENT_REPLIES
    || Number.isFinite(newestReplyAt)
      && newestReplyAt - Date.parse(`${reply.created_at.replace(' ', 'T')}Z`)
        <= LATEST_REPLY_BURST_HOURS * 60 * 60_000)
  if (keepAncestorChain) return recent
  const recentById = new Map(recent.map(reply => [reply.id, reply]))
  return recent.filter((reply, index) => {
    if (index < LATEST_UNPRUNED_RECENT_REPLIES) return true
    return !recent.slice(0, index).some(newer => {
      let ancestorId = newer.parent_id
      while (ancestorId !== null) {
        if (ancestorId === reply.id) return true
        ancestorId = recentById.get(ancestorId)?.parent_id ?? null
      }
      return false
    })
  })
}

/** Keep the recent context on the branch that actually caused an old conversation to resurface. */
export function recentActiveBranchReplies<
  T extends { id: number; parent_id: number | null; created_at: string },
>(conversation: T[]) {
  const recent = recentConversationReplies(conversation, true)
  const newest = recent[0]
  const root = conversation.find(post => post.parent_id === null)
  if (!newest || !root || newest.parent_id === root.id) return recent

  const byId = new Map(conversation.map(post => [post.id, post]))
  const newestAt = Date.parse(`${newest.created_at.replace(' ', 'T')}Z`)
  const fresh = recent.filter(post => Number.isFinite(newestAt)
    && newestAt - Date.parse(`${post.created_at.replace(' ', 'T')}Z`)
      <= LATEST_REPLY_BURST_HOURS * 60 * 60_000)
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

export function recentExpandableConversationReplies<
  T extends { id: number; parent_id: number | null; created_at: string },
>(conversation: T[]) {
  const expandableReplies = recentConversationReplies(conversation, true).slice(0, 4)
  const expandableIds = new Set([
    ...conversation.filter(post => post.parent_id === null).map(post => post.id),
    ...expandableReplies.map(reply => reply.id),
  ])
  const needsParentContext = expandableReplies.some(reply => reply.parent_id !== null
    && !expandableIds.has(reply.parent_id))
  if (!needsParentContext) {
    const connectedOlderReply = conversation.find(reply => reply.parent_id !== null
      && !expandableIds.has(reply.id) && expandableIds.has(reply.parent_id))
    if (connectedOlderReply) expandableReplies.push(connectedOlderReply)
  }
  return expandableReplies
}
