const LATEST_MIN_RECENT_REPLIES = 2
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
) {
  const replies = conversation.filter(row => row.parent_id !== null)
  const newestReplyAt = replies[0]
    ? Date.parse(`${replies[0].created_at.replace(' ', 'T')}Z`)
    : Number.NaN
  const recent = replies.slice(0, LATEST_MAX_RECENT_REPLIES).filter((reply, index) => index < LATEST_MIN_RECENT_REPLIES
    || Number.isFinite(newestReplyAt)
      && newestReplyAt - Date.parse(`${reply.created_at.replace(' ', 'T')}Z`)
        <= LATEST_REPLY_BURST_HOURS * 60 * 60_000)
  const recentById = new Map(recent.map(reply => [reply.id, reply]))
  return recent.filter((reply, index) => {
    if (index < LATEST_MIN_RECENT_REPLIES) return true
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
