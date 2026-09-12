import { Post, postAnchorId, ThreadReplies } from './post'

import type { PostView } from '../types'
import { Layout } from './layout'
import { GuestCommunityActions, postTitle } from './page-shared'
import { HiddenRepliesNotice, ReplyComposer } from './reply'
import { ThreadReplySlot } from './thread-reply-slot'

export function PublicThread(
  { post, replies = [], social, returnPath, topHref, flatHref, treeHref, flat = false, showForm = true, replyTo }: {
    post: PostView
    replies?: PostView[]
    social?: { title?: string; description: string; image: string; url: string }
    returnPath?: string
    topHref?: string
    flatHref?: string
    treeHref?: string
    flat?: boolean
    showForm?: boolean
    replyTo?: PostView
  },
) {
  const backPostId = postAnchorId(returnPath)
  const parentHref = post.parent_id
    ? `/post/${post.parent_id}${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
    : undefined
  const backTargetsReply = replies.some(reply => reply.id === backPostId && !reply.deleted_at)
  return (
    <Layout title={postTitle(post.body, post.moderation_category)} social={social}>
      <div className="post-page-thread public-post-page-thread">
        <div className="thread-root">
          <Post p={post} user={null} showParent={false} backHref={returnPath} canonicalTimestamp parentHref={parentHref}
            topHref={topHref} flatHref={flatHref} treeHref={treeHref} shareAction />
        </div>
        {showForm && !post.thread_locked && !replyTo && (
          <ReplyComposer user={null} replyParent={post} replyPageId={post.id} returnPath={returnPath} />
        )}
        {showForm && post.thread_locked && !replyTo && <ThreadReplySlot locked />}
        {post.replies_hidden && <HiddenRepliesNotice />}
        <ThreadReplies parentId={post.id} replies={replies} user={null} returnPath={returnPath} flat={flat}
          backHref={backTargetsReply ? returnPath : undefined} replyOnPage suppressReplyActionId={replyTo?.id}
          afterReply={(reply, depth) =>
            showForm && reply.id === replyTo?.id
              ? post.thread_locked
                ? <ThreadReplySlot depth={depth} locked />
                : (
                  <ThreadReplySlot depth={depth}>
                    <ReplyComposer user={null} replyParent={replyTo} replyPageId={post.id} returnPath={returnPath}
                      inline />
                  </ThreadReplySlot>
                )
              : undefined} />
      </div>
      <GuestCommunityActions className="post-page-actions" />
    </Layout>
  )
}
