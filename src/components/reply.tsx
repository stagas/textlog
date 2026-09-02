import type React from 'react'
import { POST_MAX } from '../post-body'
import { canPublishPosts } from '../posting-policy'
import type { LocationView, User } from '../types'
import type { PostView } from '../types'
import { Layout } from './layout'
import {
  FormActions,
  FormMessage,
  PostingHelp,
  PostingHelpAction,
  PostingSuggestionResults,
  type PostingSuggestionSearch,
  postTitle,
  ReportPanel,
  VerificationRequired,
} from './page-shared'
import { Panel } from './panel'
import { Post, postAnchorId, ThreadReplies } from './post'

export function ReplyBox(
  { action, body, error, placeholder, hidden, beforeTextarea, secondary, primary, className = 'replybox reply-compose',
    suggestionSearch, draftId, helpId = 'reply-posting-help', autoFocus = true }: {
      action: string
      body: string
      error?: string
      placeholder?: string
      hidden?: React.ReactNode
      beforeTextarea?: React.ReactNode
      secondary: React.ReactNode
      primary: React.ReactNode
      className?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      helpId?: string
      autoFocus?: boolean
    },
) {
  return (
    <Panel className={className}>
      <form method="post" action={action}>
        {hidden}
        {draftId && <input type="hidden" name="draft_id" value={draftId} />}
        <FormMessage error={error} />
        {beforeTextarea}
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX} autoFocus={autoFocus} defaultValue={body}
            placeholder={placeholder} autoComplete="off" inputMode="text" enterKeyHint="enter" />
          <PostingSuggestionResults search={suggestionSearch} />
          <div className="composefoot">
            <PostingHelp search={suggestionSearch} controlledBy={helpId} />
            <FormActions secondary={secondary} primary={primary} />
          </div>
        </div>
      </form>
    </Panel>
  )
}

export function ReplyPreview({ parent, user, body, executionOutput, location }: {
  parent: PostView; user: User; body: string; executionOutput?: string | null; location?: LocationView
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

export function Reply(
  { user, post, replies = [], showForm, showReport = false, reported = false, error, body = '', reportReason = '',
    reportError, social, preview = false, returnPath, topHref, flatHref, treeHref, flat = false, suggestionSearch,
    draftId, previewExecutionOutput, previewLocation, autoFocus = true, replyTo, backTargetId }: {
      user: User
      post: PostView
      replies?: PostView[]
      showForm: boolean
      showReport?: boolean
      reported?: boolean
      reportReason?: string
      reportError?: string
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
  const backTargetsReply = replies.some(reply => reply.id === backPostId && !reply.deleted_at)
  const replyParent = replyTo || post
  const replyComposer = canPublishPosts(user)
    ? (
      <ReplyBox action={`/post/${replyParent.id}/reply#post-${replyParent.id}`} body={body} error={error}
        suggestionSearch={suggestionSearch} draftId={draftId} placeholder={'Reply to @' + replyParent.handle + '…'}
        autoFocus={autoFocus}
        hidden={returnPath && <input type="hidden" name="from" value={returnPath} />}
        secondary={
          <span className="edit-post-actions">
            <PostingHelpAction id="reply-posting-help" defaultChecked={!!suggestionSearch} />
            <button className="secondary-action compose-autotag-action" name="action" value="autotag"
              title="Enrich post with hashtags">
              autotag<span className="new-badge compose-new-badge" aria-hidden="true">NEW</span>
            </button>
            <button className="secondary-action" name="action" value="preview">preview</button>
            <button className="secondary-action" name="action" value="draft"
              formAction={draftId ? `/drafts/${draftId}` : undefined}>
              draft
            </button>
          </span>
        } primary={<button className="button" accessKey="p">post →</button>} />
    )
    : <VerificationRequired />
  return (
    <Layout user={user} title={postTitle(post.body, post.moderation_category)} social={social}>
      <div className="post-page-thread">
        <div className="thread-root">
          <Post p={post} user={user} showReplyAction={!showForm || !!replyTo} showOwnerActions showModerateAction
            tappableParent
            bookmarkAction
            suppressContentWarning={showForm}
            returnPath={returnPath} backHref={returnPath} canonicalTimestamp topHref={topHref} flatHref={flatHref}
            treeHref={treeHref} reportHref={user.id !== post.user_id && !showReport && !reported
            ? `/post/${post.id}?report=1${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
            : undefined} />
        </div>
        {user.id !== post.user_id && (
          <ReportPanel post={post} showForm={showReport} reported={reported} reason={reportReason}
            error={reportError} />
        )}
        {preview && !replyTo && <ReplyPreview parent={replyParent} user={user} body={body}
          executionOutput={previewExecutionOutput} location={previewLocation} />}
        {showForm && !post.thread_locked && !replyTo && replyComposer}
        <ThreadReplies parentId={post.id} replies={replies} user={user} returnPath={returnPath} flat={flat}
          backHref={backTargetsReply || backTargetId ? returnPath : undefined} backTargetId={backTargetId}
          replyOnPage suppressReplyActionId={replyTo?.id}
          afterReply={(reply, depth) => showForm && !post.thread_locked && reply.id === replyTo?.id
            ? <>
                {preview && <ReplyPreview parent={replyParent} user={user} body={body}
                  executionOutput={previewExecutionOutput} location={previewLocation} />}
                <div className="inline-reply-compose" style={{
                  '--reply-offset': `calc(${Array(depth).fill('clamp(18px, 3vw, 28px)').join(' + ')})`,
                } as React.CSSProperties}>
                  {replyComposer}
                </div>
              </>
            : undefined} />
      </div>
    </Layout>
  )
}
