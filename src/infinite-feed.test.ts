import { describe, expect, test } from 'bun:test'
import { chunkFeedPosts, feedChunk, feedChunkReturnPath, feedPostsWithFetchedThread,
  restoredFeedChunks } from './components/infinite-feed'
import type { PostView } from './types'

describe('progressive feed chunks', () => {
  test('validates internal fragment indexes', () => {
    expect(feedChunk()).toBe(0)
    expect(feedChunk('1')).toBe(1)
    expect(feedChunk('4')).toBe(4)
    expect(feedChunk('5')).toBeNull()
    expect(restoredFeedChunks('3')).toBe(3)
    expect(restoredFeedChunks('6')).toBeNull()
  })

  test('carries the visible one-based chunk in return paths', () => {
    expect(feedChunkReturnPath('/all?page=2#post-3', 2)).toBe('/all?page=2&chunk=3#post-3')
    expect(feedChunkReturnPath('/any?seed=abc', 4)).toBe('/any?seed=abc&chunk=5')
    expect(feedChunkReturnPath('/all', 0)).toBe('/all')
  })

  test('never splits a conversation across progressive chunks', () => {
    const posts: Array<PostView & { conversation_id: number }> = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      user_id: 1,
      parent_id: null,
      body: `root ${index + 1}`,
      handle: 'writer',
      created_at: '2026-09-09 12:00:00',
      deleted_at: null,
      conversation_id: index + 1,
    }))
    posts.splice(20, 0, {
      id: 100,
      user_id: 2,
      parent_id: 20,
      body: 'reply at the old row boundary',
      handle: 'reader',
      created_at: '2026-09-09 12:01:00',
      deleted_at: null,
      conversation_id: 20,
    })

    expect(chunkFeedPosts(posts, 0).map(post => post.id)).toContain(100)
    expect(chunkFeedPosts(posts, 1).map(post => post.id)).toEqual([21])
  })

  test('replaces a projected conversation with its fetched SSR thread in place', () => {
    const post = (id: number, parentId: number | null): PostView => ({
      id, user_id: 1, parent_id: parentId, body: String(id), handle: 'writer',
      created_at: '2026-09-09 12:00:00', deleted_at: null,
    })
    const root = post(123, null)
    const projected = { ...post(125, 123), parent: root }
    const fetched = [root, { ...post(124, 123), parent: root }, projected]

    expect(feedPostsWithFetchedThread([post(10, null), projected, post(20, null)], fetched).map(item => item.id))
      .toEqual([10, 123, 124, 125, 20])
  })
})
