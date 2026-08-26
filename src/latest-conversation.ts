const LATEST_MIN_RECENT_REPLIES = 2
const LATEST_MAX_RECENT_REPLIES = 5
const LATEST_REPLY_BURST_HOURS = 48

export function recentConversationReplies<T extends { parent_id: number | null; created_at: string }>(
  conversation: T[],
) {
  const replies = conversation.filter(row => row.parent_id !== null)
  const newestReplyAt = replies[0]
    ? Date.parse(`${replies[0].created_at.replace(' ', 'T')}Z`)
    : Number.NaN
  return replies.slice(0, LATEST_MAX_RECENT_REPLIES).filter((reply, index) => index < LATEST_MIN_RECENT_REPLIES
    || Number.isFinite(newestReplyAt)
      && newestReplyAt - Date.parse(`${reply.created_at.replace(' ', 'T')}Z`)
        <= LATEST_REPLY_BURST_HOURS * 60 * 60_000)
}
