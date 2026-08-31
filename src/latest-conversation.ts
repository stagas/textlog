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
  const branchId = (post: T) => {
    let branch = post
    while (branch.parent_id !== null && branch.parent_id !== root.id) {
      const parent = byId.get(branch.parent_id)
      if (!parent) return null
      branch = parent
    }
    return branch.parent_id === root.id ? branch.id : null
  }
  const activeBranchId = branchId(newest)
  const newestAncestorIds = new Set<number>()
  let ancestorId = newest.parent_id
  while (ancestorId !== null) {
    newestAncestorIds.add(ancestorId)
    ancestorId = byId.get(ancestorId)?.parent_id ?? null
  }
  return activeBranchId === null ? recent : recent.filter(post => branchId(post) === activeBranchId
    && (newestAncestorIds.has(post.id) || Number.isFinite(newestAt)
      && newestAt - Date.parse(`${post.created_at.replace(' ', 'T')}Z`)
        <= LATEST_REPLY_BURST_HOURS * 60 * 60_000))
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
