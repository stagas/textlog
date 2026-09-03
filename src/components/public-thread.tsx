import type React from 'react'
import { Post, postAnchorId, ThreadReplies } from './post'

import type { PostView } from '../types'
import { Layout } from './layout'
import { GuestCommunityActions, postTitle } from './page-shared'
import { ReplyComposer } from './reply'

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
  const backTargetsReply = replies.some(reply => reply.id === backPostId && !reply.deleted_at)
  return (
    <Layout title={postTitle(post.body, post.moderation_category)} social={social}>
      <div className="post-page-thread public-post-page-thread">
        <div className="thread-root">
          <Post p={post} user={null} tappableParent backHref={returnPath} canonicalTimestamp topHref={topHref}
            flatHref={flatHref} treeHref={treeHref} />
        </div>
        {showForm && !post.thread_locked && !replyTo && (
          <ReplyComposer user={null} replyParent={post} replyPageId={post.id} returnPath={returnPath} />
        )}
        <ThreadReplies parentId={post.id} replies={replies} user={null} returnPath={returnPath} flat={flat}
          backHref={backTargetsReply ? returnPath : undefined} replyOnPage suppressReplyActionId={replyTo?.id}
          afterReply={(reply, depth) =>
            showForm && !post.thread_locked && reply.id === replyTo?.id
              ? (
                <div className="inline-reply-compose" style={{
                  '--reply-offset': `calc(${Array(depth).fill('clamp(18px, 3vw, 28px)').join(' + ')})`,
                } as React.CSSProperties}>
                  <ReplyComposer user={null} replyParent={replyTo} replyPageId={post.id} returnPath={returnPath}
                    inline />
                </div>
              )
              : undefined} />
      </div>
      <GuestCommunityActions className="post-page-actions" />
    </Layout>
  )
}
