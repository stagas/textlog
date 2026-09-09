import type { PostView, User } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { CenteredPanel, PanelCopy } from './panel'
import { Post } from './post'

const reasons = ['harassment', 'spam', 'impersonation', 'bot', 'other']

export function ReportPost({ user, post, reason = '', error, reported = false, returnPath }: {
  user: User
  post: PostView
  reason?: string
  error?: string
  reported?: boolean
  returnPath?: string
}) {
  const back = `/post/${post.id}${returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''}`
  return (
    <Layout user={user} title={`report @${post.handle}'s post`}>
      <CenteredPanel shellClassName="auth-shell report-post-shell" className="auth-panel report-post-panel" width="wide"
        tone={reported ? 'default' : 'danger'}
      >
        <p className="eyebrow">community safety</p>
        <h1>{reported ? 'Report received' : 'Report this post?'}</h1>
        {reported
          ? (
            <>
              <p>Thank you. The report has been recorded for review.</p>
              <form method="post" action={`/block/${post.handle}`}>
                <FormActions
                  secondary={<a className="secondary-action" href={back}>back to post</a>}
                  primary={<button className="button button-danger">block @{post.handle}</button>}
                />
              </form>
            </>
          )
          : (
            <>
              <PanelCopy>Select the reason that best describes the problem.</PanelCopy>
              <div className="report-post-preview" aria-label="Post being reported">
                <Post p={post} user={user} showReplyAction={false} showReadAction={false} />
              </div>
              <form method="post" action={`/post/${post.id}/report`}>
                {returnPath && <input type="hidden" name="from" value={returnPath} />}
                <FormMessage error={error} />
                <label className="form-label">
                  reason
                  <select className="form-control form-select" name="reason" required defaultValue={reason}>
                    <option value="" disabled>choose a reason</option>
                    {!!reason && !reasons.includes(reason) && <option value={reason} hidden>{reason}</option>}
                    <option value="harassment">harassment</option>
                    <option value="spam">spam</option>
                    <option value="impersonation">impersonation</option>
                    <option value="bot">bot</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <FormActions
                  secondary={<a className="secondary-action cancel-action" href={back}>cancel</a>}
                  primary={<button className="button button-danger" type="submit">submit report</button>}
                />
              </form>
            </>
          )}
      </CenteredPanel>
    </Layout>
  )
}
