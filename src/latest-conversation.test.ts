import { expect, test } from 'bun:test'
import { collapsedConversationPreview, projectRecentConversation } from './latest-conversation'

const reply = (id: number, createdAt: string) => ({ id, parent_id: 895, created_at: createdAt })

test('folded previews retain the immediate parent of an unread reply', () => {
  const replies = [
    { id: 3, parent_id: 2, created_at: '2026-09-02 14:35:48', feed_collapsed_preview: true },
    { id: 2, parent_id: 1, created_at: '2026-09-02 14:24:47' },
    { id: 4, parent_id: 1, created_at: '2026-09-02 14:30:05', feed_collapsed_preview: true },
  ]

  expect(collapsedConversationPreview(replies, new Set([3])).map(post => post.id)).toEqual([3, 4, 2])
})

test('Latest includes a recent reply burst plus one connected older reply', () => {
  const conversation = [
    reply(2607, '2026-08-26 23:28:22'),
    reply(2602, '2026-08-26 22:10:21'),
    reply(2600, '2026-08-26 22:07:23'),
    reply(2599, '2026-08-26 22:03:54'),
    reply(922, '2026-08-11 14:41:06'),
    { id: 895, parent_id: null, created_at: '2026-08-11 09:41:26' },
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id))
    .toEqual([2607, 2602, 2600, 2599, 922])
})

test('Latest includes additional replies from the newest 48-hour burst', () => {
  const conversation = [
    reply(4, '2026-08-26 23:00:00'),
    reply(3, '2026-08-25 23:00:00'),
    reply(2, '2026-08-25 11:00:00'),
    reply(1, '2026-08-23 23:00:00'),
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id)).toEqual([4, 3, 2, 1])
})

test('Latest keeps the three preceding replies when the newest reply arrives after an old conversation', () => {
  const conversation = [
    { ...reply(2716, '2026-08-28 03:51:52'), parent_id: 35 },
    { ...reply(47, '2026-08-07 15:53:52'), parent_id: 35 },
    { ...reply(41, '2026-08-07 15:46:39'), parent_id: 35 },
    { ...reply(40, '2026-08-07 15:46:19'), parent_id: 35 },
    { ...reply(37, '2026-08-07 15:45:17'), parent_id: 35 },
    { id: 35, parent_id: null, created_at: '2026-08-07 15:44:34' },
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id)).toEqual([2716, 47, 41, 40, 37])
})

test('Latest retains a root when a fresh direct reply anchors the newest nested branch', () => {
  const root = { id: 1, parent_id: null, created_at: '2026-08-27 17:34:29' }
  const conversation = [
    { id: 3, parent_id: 2, created_at: '2026-08-27 19:35:47' },
    { id: 2, parent_id: 1, created_at: '2026-08-27 18:20:32' },
    root,
  ]

  expect(projectRecentConversation(conversation).keepsRoot).toBeTrue()
  expect(projectRecentConversation([conversation[0], conversation[1],
    { ...root, created_at: '2026-08-24 17:34:29' }]).keepsRoot).toBeTrue()
  expect(projectRecentConversation([
    conversation[0],
    { ...conversation[1], created_at: '2026-08-24 18:20:32' },
    { ...root, created_at: '2026-08-24 17:34:29' },
  ]).keepsRoot).toBeFalse()
})

test('Latest bounds a recent nested reply path at five while filling missing parent context', () => {
  const conversation = [
    { id: 6, parent_id: 5, created_at: '2026-08-27 19:35:47' },
    { id: 5, parent_id: 4, created_at: '2026-08-27 19:09:50' },
    { id: 7, parent_id: 2, created_at: '2026-08-27 19:01:26' },
    { id: 4, parent_id: 3, created_at: '2026-08-27 18:53:47' },
    { id: 3, parent_id: 2, created_at: '2026-08-27 18:48:15' },
    { id: 2, parent_id: 1, created_at: '2026-08-27 18:20:32' },
    { id: 1, parent_id: null, created_at: '2026-08-27 17:34:29' },
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id)).toEqual([6, 5, 7, 4, 2])
})

test('Latest groups fresh branches under their shared parent without promoting stale siblings', () => {
  const conversation = [
    { id: 2928, parent_id: 1182, created_at: '2026-08-30 21:00:39' },
    { id: 2564, parent_id: 2296, created_at: '2026-08-26 15:31:31' },
    { id: 2557, parent_id: 2553, created_at: '2026-08-26 14:37:52' },
    { id: 2553, parent_id: 2547, created_at: '2026-08-26 13:49:06' },
    { id: 2547, parent_id: 2537, created_at: '2026-08-26 13:31:10' },
    { id: 2537, parent_id: 2279, created_at: '2026-08-26 12:51:28' },
    { id: 2296, parent_id: 1174, created_at: '2026-08-24 20:42:07' },
    { id: 2279, parent_id: 1309, created_at: '2026-08-24 15:28:04' },
    { id: 1309, parent_id: 1182, created_at: '2026-08-14 23:17:36' },
    { id: 1182, parent_id: 1174, created_at: '2026-08-14 06:52:13' },
    { id: 1174, parent_id: null, created_at: '2026-08-14 00:02:46' },
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id)).toEqual([2928, 1182])
})

test('Latest retains fresh sibling branches beneath their nearest shared parent', () => {
  const conversation = [
    { id: 10, parent_id: 8, created_at: '2026-08-30 12:00:00' },
    { id: 9, parent_id: 7, created_at: '2026-08-30 11:00:00' },
    { id: 8, parent_id: 6, created_at: '2026-08-29 10:00:00' },
    { id: 7, parent_id: 5, created_at: '2026-08-28 10:00:00' },
    { id: 6, parent_id: 5, created_at: '2026-08-27 10:00:00' },
    { id: 5, parent_id: 1, created_at: '2026-08-20 10:00:00' },
    { id: 1, parent_id: null, created_at: '2026-08-01 10:00:00' },
  ]

  expect(projectRecentConversation(conversation).replies.map(post => post.id)).toEqual([10, 9, 8, 5])
})

test('expandable rooted conversations keep two to five replies including needed parent context', () => {
  const conversation = [
    { id: 2834, parent_id: 370, created_at: '2026-08-29 11:25:06' },
    { id: 2833, parent_id: 2829, created_at: '2026-08-29 11:22:11' },
    { id: 2829, parent_id: 370, created_at: '2026-08-29 10:49:12' },
    { id: 2370, parent_id: 370, created_at: '2026-08-25 03:11:23' },
    { id: 370, parent_id: null, created_at: '2026-08-08 02:32:30' },
  ]

  expect(projectRecentConversation(conversation, { forceRoot: true }).replies.map(post => post.id))
    .toEqual([2834, 2833, 2829, 2370])
})

test('expandable rooted conversations retain five replies but strongly favor recent direct replies while folded', () => {
  const conversation = [
    { id: 2956, parent_id: 2955, created_at: '2026-08-31 15:54:59' },
    { id: 2955, parent_id: 2954, created_at: '2026-08-31 15:53:24' },
    { id: 2954, parent_id: 2953, created_at: '2026-08-31 15:47:09' },
    { id: 2953, parent_id: 1495, created_at: '2026-08-31 15:42:10' },
    { id: 2904, parent_id: 1495, created_at: '2026-08-30 13:20:03' },
    { id: 1495, parent_id: null, created_at: '2026-08-16 14:10:58' },
  ]

  const projection = projectRecentConversation(conversation, { forceRoot: true })
  expect(projection.replies.map(post => post.id)).toEqual([2956, 2955, 2954, 2953, 2904])
  expect([...projection.previewReplyIds]).toEqual([2953, 2904])
})

test('short rooted conversations retain an intermediate for expansion but omit it while folded', () => {
  const conversation = [
    { id: 2945, parent_id: 2944, created_at: '2026-08-31 14:14:46' },
    { id: 2944, parent_id: 2943, created_at: '2026-08-31 14:09:01' },
    { id: 2943, parent_id: 2942, created_at: '2026-08-31 14:06:08' },
    { id: 2942, parent_id: null, created_at: '2026-08-31 13:28:29' },
  ]
  const projection = projectRecentConversation(conversation)

  expect(projection.keepsRoot).toBeTrue()
  expect(projection.replies.map(post => post.id)).toEqual([2945, 2944, 2943])
  expect([...projection.previewReplyIds]).toEqual([2945, 2943])
})

test('rooted conversations use the fifth expansion slot for a missing direct ancestor', () => {
  const conversation = [
    { id: 2965, parent_id: 2964, created_at: '2026-08-31 20:00:49' },
    { id: 2964, parent_id: 2963, created_at: '2026-08-31 19:58:44' },
    { id: 2963, parent_id: 2962, created_at: '2026-08-31 19:57:35' },
    { id: 2962, parent_id: 2961, created_at: '2026-08-31 19:55:17' },
    { id: 2961, parent_id: 2958, created_at: '2026-08-31 19:54:48' },
    { id: 2958, parent_id: null, created_at: '2026-08-31 18:53:23' },
  ]
  const projection = projectRecentConversation(conversation)

  expect(projection.keepsRoot).toBeTrue()
  expect(projection.replies.map(post => post.id)).toEqual([2965, 2964, 2963, 2962, 2961])
  expect([...projection.previewReplyIds]).toEqual([2965, 2961])
})

test('Any favors post 281 recent direct replies before capping deep expansion rows', () => {
  const conversation = [
    { id: 568, parent_id: 543, created_at: '2026-08-08 20:31:09' },
    { id: 543, parent_id: 358, created_at: '2026-08-08 17:50:45' },
    { id: 461, parent_id: 393, created_at: '2026-08-08 10:08:26' },
    { id: 460, parent_id: 361, created_at: '2026-08-08 10:05:44' },
    { id: 393, parent_id: 281, created_at: '2026-08-08 04:31:01' },
    { id: 361, parent_id: 358, created_at: '2026-08-08 01:57:13' },
    { id: 358, parent_id: 344, created_at: '2026-08-08 01:32:54' },
    { id: 344, parent_id: 281, created_at: '2026-08-08 01:01:20' },
    { id: 281, parent_id: null, created_at: '2026-08-07 22:32:33' },
  ]
  const projection = projectRecentConversation(conversation)

  expect(projection.replies.map(post => post.id)).toEqual([568, 543, 461, 393, 344])
  expect([...projection.previewReplyIds]).toEqual([393, 344])
})
