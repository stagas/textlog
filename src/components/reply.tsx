import { type User } from '../db'
import { canPublishPosts } from '../posting-policy'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage, postTitle, ReportPanel, VerificationRequired } from './page-shared'
import { Post, ThreadReplies } from './post'

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
          <ReportPanel post={post} showForm={showReport} reported={reported} reason={reportReason} error={reportError} />
        )}
        {preview && (
          <div className="reply-preview">
            <p className="eyebrow">preview</p>
            <div className="reply-branch">
              <div className="reply-node">
                <Post p={{
                  id: 0,
                  user_id: user.id,
                  parent_id: post.id,
                  body,
                  created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
                  deleted_at: null,
                  handle: user.handle,
                  bio: user.bio,
                }} user={user} replyHref="#" showParent={false} preview />
              </div>
            </div>
          </div>
        )}
        {showForm && (
          canPublishPosts(user)
            ? (
              <div className="panel replybox">
                <form method="post" action={'/post/' + post.id + '/reply'}>
                  {returnPath && <input type="hidden" name="from" value={returnPath} />}
                  <FormMessage error={error} />
                  <textarea className="form-control" name="body" maxLength={280} required autoFocus defaultValue={body}
                    placeholder={'Reply to @' + post.handle + '…'} />
                  <div className="composefoot">
                    <span>280 characters max · use #hashtags and @mentions</span>
                    <FormActions
                      secondary={<button className="secondary-action" name="action" value="preview">preview</button>}
                      primary={<button className="button">post →</button>}
                    />
                  </div>
                </form>
              </div>
            )
            : <VerificationRequired />
        )}
        <ThreadReplies parentId={post.id} user={user} returnPath={returnPath} />
      </div>
    </Layout>
  )
}
