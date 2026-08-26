import { expect, test } from 'bun:test'
import { recentConversationReplies } from './latest-conversation'

const reply = (id: number, createdAt: string) => ({ id, parent_id: 895, created_at: createdAt })

test('Latest includes a recent reply burst while leaving older replies out of the first page', () => {
  const conversation = [
    reply(2607, '2026-08-26 23:28:22'),
    reply(2602, '2026-08-26 22:10:21'),
    reply(2600, '2026-08-26 22:07:23'),
    reply(2599, '2026-08-26 22:03:54'),
    reply(922, '2026-08-11 14:41:06'),
    { id: 895, parent_id: null, created_at: '2026-08-11 09:41:26' },
  ]

  expect(recentConversationReplies(conversation).map(post => post.id)).toEqual([2607, 2602, 2600, 2599])
})

test('Latest includes additional replies from the newest 48-hour burst', () => {
  const conversation = [
    reply(4, '2026-08-26 23:00:00'),
    reply(3, '2026-08-25 23:00:00'),
    reply(2, '2026-08-25 11:00:00'),
    reply(1, '2026-08-23 23:00:00'),
  ]

  expect(recentConversationReplies(conversation).map(post => post.id)).toEqual([4, 3, 2])
})
