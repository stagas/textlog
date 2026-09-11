import type { PostView, User } from '../types'
import { chunkFeedPosts, FEED_CHUNK_SIZE, feedConversationGroups, InfiniteFeedChunk } from './infinite-feed'
import { FeedThreads } from './post'

export function ThreadedFeedChunks({ posts, user, returnPath, chunk = 0, initialChunks = 1, ...threadProps }: {
  posts: PostView[]
  user: User | null
  returnPath: string
  chunk?: number
  initialChunks?: number
  expandedRootId?: number
  expandedByDefault?: boolean
  promoteAncestors?: boolean | 'all'
  collapseWithoutPreviews?: boolean
  contextUnreadPostIds?: ReadonlySet<number>
  contextDirectedUnreadPostIds?: ReadonlySet<number>
  showHiddenRepliesNotices?: boolean
  className?: string
}) {
  const renderedChunk = chunk === 0 ? initialChunks - 1 : chunk
  const conversationCount = feedConversationGroups(posts).length
  return (
    <InfiniteFeedChunk chunk={renderedChunk} hasMore={conversationCount > (renderedChunk + 1) * FEED_CHUNK_SIZE}>
      <FeedThreads posts={chunkFeedPosts(posts, chunk, initialChunks)} user={user} returnPath={returnPath}
        {...threadProps} />
    </InfiniteFeedChunk>
  )
}
