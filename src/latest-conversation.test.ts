import { expect, test } from 'bun:test'
import { isRecentConversationRoot, recentActiveBranchReplies, recentConversationReplies,
  recentExpandableConversationReplies } from './latest-conversation'

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

  expect(recentConversationReplies(conversation).map(post => post.id)).toEqual([4, 3, 2, 1])
})

test('Latest keeps the three preceding replies when the newest reply arrives after an old conversation', () => {
  const conversation = [
    reply(2716, '2026-08-28 03:51:52'),
    reply(47, '2026-08-07 15:53:52'),
    reply(41, '2026-08-07 15:46:39'),
    reply(40, '2026-08-07 15:46:19'),
    reply(37, '2026-08-07 15:45:17'),
    { id: 35, parent_id: null, created_at: '2026-08-07 15:44:34' },
  ]

  expect(recentConversationReplies(conversation).map(post => post.id)).toEqual([2716, 47, 41, 40])
})

test('Latest retains a recent root when its newest replies are nested', () => {
  const root = { id: 1, parent_id: null, created_at: '2026-08-27 17:34:29' }
  const conversation = [
    { id: 3, parent_id: 2, created_at: '2026-08-27 19:35:47' },
    { id: 2, parent_id: 1, created_at: '2026-08-27 18:20:32' },
    root,
  ]

  expect(isRecentConversationRoot(root, conversation)).toBeTrue()
  expect(isRecentConversationRoot({ ...root, created_at: '2026-08-24 17:34:29' }, conversation)).toBeFalse()
})

test('Latest prunes older intermediates from a recent nested reply path', () => {
  const conversation = [
    { id: 6, parent_id: 5, created_at: '2026-08-27 19:35:47' },
    { id: 5, parent_id: 4, created_at: '2026-08-27 19:09:50' },
    { id: 7, parent_id: 2, created_at: '2026-08-27 19:01:26' },
    { id: 4, parent_id: 3, created_at: '2026-08-27 18:53:47' },
    { id: 3, parent_id: 2, created_at: '2026-08-27 18:48:15' },
    { id: 2, parent_id: 1, created_at: '2026-08-27 18:20:32' },
    { id: 1, parent_id: null, created_at: '2026-08-27 17:34:29' },
  ]

  expect(recentConversationReplies(conversation).map(post => post.id)).toEqual([6, 5, 7])
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

  expect(recentActiveBranchReplies(conversation).map(post => post.id)).toEqual([2928, 1182])
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

  expect(recentActiveBranchReplies(conversation).map(post => post.id)).toEqual([10, 9, 8, 5])
})

test('expandable rooted conversations keep two to five replies including needed parent context', () => {
  const conversation = [
    { id: 2834, parent_id: 370, created_at: '2026-08-29 11:25:06' },
    { id: 2833, parent_id: 2829, created_at: '2026-08-29 11:22:11' },
    { id: 2829, parent_id: 370, created_at: '2026-08-29 10:49:12' },
    { id: 2370, parent_id: 370, created_at: '2026-08-25 03:11:23' },
    { id: 370, parent_id: null, created_at: '2026-08-08 02:32:30' },
  ]

  expect(recentExpandableConversationReplies(conversation).map(post => post.id))
    .toEqual([2834, 2833, 2829, 2370])
})
