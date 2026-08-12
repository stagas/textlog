import type React from 'react'
import { type User } from '../db'
import { canPublishPosts } from '../posting-policy'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage, PostingHelp, postTitle, ReportPanel, VerificationRequired } from './page-shared'
import { Post, PreviewPost, ThreadReplies } from './post'

export function ReplyBox(
  { action, body, error, placeholder, hidden, beforeTextarea, secondary, primary, className = 'replybox' }: {
    action: string
    body: string
    error?: string
    placeholder?: string
    hidden?: React.ReactNode
    beforeTextarea?: React.ReactNode
    secondary: React.ReactNode
    primary: React.ReactNode
    className?: string
  },
) {
  return (
    <div className={`panel ${className}`}>
      <form method="post" action={action}>
        {hidden}
        <FormMessage error={error} />
        {beforeTextarea}
        <textarea className="form-control" name="body" maxLength={280} required autoFocus defaultValue={body}
          placeholder={placeholder} />
        <div className="composefoot">
          <PostingHelp />
          <FormActions secondary={secondary} primary={primary} />
        </div>
      </form>
    </div>
  )
}

export function ReplyPreview({ parentId, user, body }: { parentId: number; user: User; body: string }) {
  return (
    <div className="reply-preview">
      <p className="eyebrow">preview</p>
      <div className="reply-branch">
        <div className="reply-node">
          <PreviewPost p={{
            id: 0,
            user_id: user.id,
            parent_id: parentId,
            body,
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            deleted_at: null,
            handle: user.handle,
            bio: user.bio,
          }} />
        </div>
      </div>
    </div>
  )
}

export function Reply(
  { user, post, showForm, showReport = false, reported = false, error, body = '', reportReason = '', reportError,
    social, preview = false, returnPath }: {
      user: User
      post: PostView
      showForm: boolean
      showReport?: boolean
      reported?: boolean
      reportReason?: string
      reportError?: string
      error?: string
      social?: { description: string; image: string; url: string }
      body?: string
      preview?: boolean
      returnPath?: string
    },
) {
  return (
    <Layout user={user} title={postTitle(post.body)} social={social}>
      <div className="post-page-thread">
        <div className="thread-root">
          <Post p={post} user={user} showReplyAction={!showForm} showOwnerActions showModerateAction tappableParent
            returnPath={returnPath} backHref={returnPath}
            reportHref={user.id !== post.user_id && !showReport && !reported
              ? `/post/${post.id}?report=1${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
              : undefined} />
        </div>
        {user.id !== post.user_id && (
          <ReportPanel post={post} showForm={showReport} reported={reported} reason={reportReason}
            error={reportError} />
        )}
        {preview && <ReplyPreview parentId={post.id} user={user} body={body} />}
        {showForm && (
          canPublishPosts(user)
            ? (
              <ReplyBox action={'/post/' + post.id + '/reply'} body={body} error={error}
                placeholder={'Reply to @' + post.handle + '…'}
                hidden={returnPath && <input type="hidden" name="from" value={returnPath} />}
                secondary={<button className="secondary-action" name="action" value="preview">preview</button>}
                primary={<button className="button">post →</button>} />
            )
            : <VerificationRequired />
        )}
        <ThreadReplies parentId={post.id} user={user} returnPath={returnPath} />
      </div>
    </Layout>
  )
}
