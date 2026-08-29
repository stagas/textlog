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
  PostingSuggestionResults,
  type PostingSuggestionSearch,
  postTitle,
  ReportPanel,
  VerificationRequired,
} from './page-shared'
import { Panel } from './panel'
import { Post, ThreadReplies } from './post'

export function ReplyBox(
  { action, body, error, placeholder, hidden, beforeTextarea, secondary, primary, className = 'replybox reply-compose',
    suggestionSearch, draftId }: {
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
      draftId?: number
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
          <textarea className="form-control" name="body" maxLength={POST_MAX} required autoFocus defaultValue={body}
            placeholder={placeholder} autoComplete="off" inputMode="text" enterKeyHint="enter" />
        </div>
        <PostingSuggestionResults search={suggestionSearch} />
        <div className="composefoot">
          <PostingHelp search={suggestionSearch} />
          <FormActions secondary={secondary} primary={primary} />
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
    draftId, previewExecutionOutput, previewLocation }: {
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
      draftId?: number
      previewExecutionOutput?: string | null
      previewLocation?: LocationView
    },
) {
  return (
    <Layout user={user} title={postTitle(post.body)} social={social}>
      <div className="post-page-thread">
        <div className="thread-root">
          <Post p={post} user={user} showReplyAction={!showForm} showOwnerActions showModerateAction tappableParent
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
        {preview && <ReplyPreview parent={post} user={user} body={body} executionOutput={previewExecutionOutput}
          location={previewLocation} />}
        {showForm && !post.thread_locked && (
          canPublishPosts(user)
            ? (
              <ReplyBox action={'/post/' + post.id + '/reply'} body={body} error={error}
                suggestionSearch={suggestionSearch} draftId={draftId} placeholder={'Reply to @' + post.handle + '…'}
                hidden={returnPath && <input type="hidden" name="from" value={returnPath} />}
                secondary={
                  <span className="edit-post-actions">
                    <a className="secondary-action cancel-action edit-post-cancel"
                      href={returnPath || `/post/${post.id}`}
                    >
                      cancel
                    </a>
                    <button className="secondary-action" name="action" value="preview">preview</button>
                    <button className="secondary-action" name="action" value="draft"
                      formAction={draftId ? `/drafts/${draftId}` : undefined}
                    >
                      draft
                    </button>
                  </span>
                } primary={<button className="button" accessKey="p">post →</button>} />
            )
            : <VerificationRequired />
        )}
        <ThreadReplies parentId={post.id} replies={replies} user={user} returnPath={returnPath} flat={flat} />
      </div>
    </Layout>
  )
}
