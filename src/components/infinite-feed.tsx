import React from 'preact/compat'
import type { PostView } from '../types'

export const FEED_CHUNK_SIZE = 20
export const FEED_CHUNKS_PER_PAGE = 5

export function feedChunk(value?: string) {
  if (value === undefined) return 0
  const chunk = Number(value)
  return Number.isInteger(chunk) && chunk >= 1 && chunk < FEED_CHUNKS_PER_PAGE ? chunk : null
}

export function restoredFeedChunks(value?: string) {
  if (value === undefined) return 1
  const chunks = Number(value)
  return Number.isInteger(chunks) && chunks >= 1 && chunks <= FEED_CHUNKS_PER_PAGE ? chunks : null
}

export function chunkItems<T>(items: T[], chunk: number) {
  const start = chunk * FEED_CHUNK_SIZE
  return items.slice(start, start + FEED_CHUNK_SIZE)
}

function feedConversationId(post: PostView & { conversation_id?: number }) {
  if (post.conversation_id) return post.conversation_id
  let root: PostView | NonNullable<PostView['parent']> = post
  while (root.parent) root = root.parent
  return root.id
}

/** Chunk flattened feed rows without splitting one rendered conversation across chunks. */
export function feedConversationGroups(posts: PostView[]) {
  const groups = new Map<number, PostView[]>()
  for (const post of posts) {
    const id = feedConversationId(post)
    groups.set(id, [...(groups.get(id) || []), post])
  }
  return [...groups.values()]
}

export function feedPostsWithFetchedThread(posts: PostView[], fetchedThread?: PostView[]) {
  if (!fetchedThread?.length) return posts
  const rootId = fetchedThread[0]!.id
  const first = posts.findIndex(post => feedConversationId(post) === rootId)
  if (first < 0) return posts
  const retained = posts.filter(post => feedConversationId(post) !== rootId)
  retained.splice(first, 0, ...fetchedThread)
  return retained
}

export function chunkFeedPosts(posts: PostView[], chunk: number, initialChunks = 1) {
  const groups = feedConversationGroups(posts)
  const start = chunk === 0 ? 0 : chunk * FEED_CHUNK_SIZE
  const end = chunk === 0 ? initialChunks * FEED_CHUNK_SIZE : start + FEED_CHUNK_SIZE
  return groups.slice(start, end).flat()
}

/** Preserve which progressively loaded chunk an item's return path belongs to. */
export function feedChunkReturnPath(path: string, chunk: number) {
  if (chunk === 0) return path
  const url = new URL(path, 'http://textlog.local')
  url.searchParams.set('chunk', String(chunk + 1))
  return url.pathname + url.search + url.hash
}

export function InfiniteFeedChunk({ chunk, hasMore, children }: {
  chunk: number
  hasMore: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <div className="infinite-feed-chunk" data-feed-chunk={chunk + 1}>{children}</div>
      {hasMore && chunk + 1 < FEED_CHUNKS_PER_PAGE
        && <div className="infinite-feed-sentinel" data-feed-next={chunk + 1} aria-hidden="true" />}
    </>
  )
}
