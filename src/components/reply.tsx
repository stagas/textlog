import { canPublishPosts } from '../posting-policy'
import type { LocationView, User } from '../types'
import type { PostView } from '../types'
import { Layout } from './layout'
import {
  type PostingSuggestionSearch,
  postTitle,
  VerificationRequired,
} from './page-shared'
import { Post, postAnchorId, ThreadReplies } from './post'
import { ReplyBox, ReplyComposer } from './reply-composer'
export { ReplyBox, ReplyComposer } from './reply-composer'

export function ReplyPreview({ parent, user, body, executionOutput, location }: {
  parent: PostView
  user: User
  body: string
  executionOutput?: string | null
  location?: LocationView
}) {
  return (
    <div className="reply-preview">
      <p className="eyebrow">preview</p>
      <div className="reply-branch">
        <div className="reply-node">
          <Post p={{
            id: 0,
            user_id: user.id,
            parent_id: parent.id,
            body,
            execution_output: executionOutput,
            location,
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            deleted_at: null,
            handle: user.handle,
            bio: user.bio,
            parent: { ...parent, reply_count: parent.reply_count || 0 },
          }} user={user} preview showParent={false} />
        </div>
      </div>
    </div>
  )
}


export function HiddenRepliesNotice() {
  return (
    <div className="reply-branch hidden-replies-notice">
      <div className="reply-node">
        <article className="post">
          <div className="post-body quiet">(replies are hidden until you answer the quiz)</div>
        </article>
      </div>
    </div>
  )
}

export function ThreadLockedNotice() {
  return <div className="thread-locked-notice" role="status">Thread is locked for new replies</div>
}

export function Reply(
  { user, post, replies = [], showForm, error, body = '', social, preview = false, returnPath, topHref, flatHref,
    treeHref, flat = false, suggestionSearch, draftId, previewExecutionOutput, previewLocation, autoFocus = true,
    replyTo, backTargetId }: {
      user: User
      post: PostView
      replies?: PostView[]
      showForm: boolean
      error?: string
      social?: { title?: string; description: string; image: string; url: string }
      body?: string
      preview?: boolean
      returnPath?: string
      topHref?: string
      flatHref?: string
      treeHref?: string
      flat?: boolean
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      previewExecutionOutput?: string | null
      previewLocation?: LocationView
      autoFocus?: boolean
      replyTo?: PostView
      backTargetId?: number
    },
) {
  const backPostId = postAnchorId(returnPath)
  const parentHref = post.parent_id
    ? `/post/${post.parent_id}${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
    : undefined
  const backTargetsReply = replies.some(reply => reply.id === backPostId && !reply.deleted_at)
  const replyParent = replyTo || post
  const activeReplyReturnPath = replyTo
    ? `/post/${post.id}?to=${replyTo.id}${backTargetId ? `&back=${backTargetId}` : ''}${
      returnPath ? '&from=' + encodeURIComponent(returnPath) : ''
    }`
    : undefined
  const replyComposer = canPublishPosts(user)
    ? (
      <ReplyComposer user={user} replyParent={replyParent} replyPageId={post.id} returnPath={returnPath}
        inline={!!replyTo} body={body} error={error} suggestionSearch={suggestionSearch} draftId={draftId}
        autoFocus={autoFocus} />
    )
    : <VerificationRequired />
  return (
    <Layout user={user} title={postTitle(post.body, post.moderation_category)} social={social}>
      <div className="post-page-thread">
        <div className="thread-root">
          <Post p={post} user={user} showParent={false} showReplyAction={showForm} showOwnerActions
            showModerateAction bookmarkAction shareAction suppressContentWarning={showForm} returnPath={returnPath}
            backHref={returnPath} canonicalTimestamp parentHref={parentHref} topHref={topHref} flatHref={flatHref}
            treeHref={treeHref} reportHref={user.id !== post.user_id
            ? `/post/${post.id}/report${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
            : undefined} />
        </div>
        {preview && !replyTo && (
          <ReplyPreview parent={replyParent} user={user} body={body} executionOutput={previewExecutionOutput}
            location={previewLocation} />
        )}
        {showForm && !post.thread_locked && !replyTo && replyComposer}
        {showForm && post.thread_locked && !replyTo && (
          <div className="inline-reply-compose thread-locked-reply-notice"
            style={{ '--reply-offset': '0px' } as React.CSSProperties}>
            <ThreadLockedNotice />
          </div>
        )}
        {post.replies_hidden && <HiddenRepliesNotice />}
        <ThreadReplies parentId={post.id} replies={replies} user={user} returnPath={returnPath} flat={flat}
          backHref={backTargetsReply || backTargetId ? returnPath : undefined} backTargetId={backTargetId} replyOnPage
          suppressReplyActionId={replyTo?.id} activeReplyReturnPath={activeReplyReturnPath}
          afterReply={(reply, depth) =>
            showForm && reply.id === replyTo?.id
              ? post.thread_locked
                ? (
                  <div className="inline-reply-compose thread-locked-reply-notice" style={{
                    '--reply-offset': `calc(${Array(depth).fill('clamp(18px, 3vw, 28px)').join(' + ')})`,
                  } as React.CSSProperties}>
                    <ThreadLockedNotice />
                  </div>
                )
                : (
                  <>
                    {preview && (
                      <ReplyPreview parent={replyParent} user={user} body={body}
                        executionOutput={previewExecutionOutput} location={previewLocation} />
                    )}
                    <div className="inline-reply-compose feed-inline-reply-compose"
                      data-reply-post-id={reply.id} style={{
                      '--reply-offset': `calc(${Array(depth).fill('clamp(18px, 3vw, 28px)').join(' + ')})`,
                    } as React.CSSProperties}>
                      {replyComposer}
                    </div>
                  </>
                )
              : undefined} />
      </div>
    </Layout>
  )
}
