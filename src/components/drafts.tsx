import type { DraftView, User } from '../types'
import { displayPostBody } from '../utils'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { CenteredPanel } from './panel'
import { Post } from './post'

export function Drafts({ user, drafts, returnPath }: { user: User; drafts: DraftView[]; returnPath?: string }) {
  const editFrom = returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''
  return (
    <Layout user={user} title="drafts">
      <div className="drafts-page">
        <PageHeading className="drafts-heading" eyebrow="writing" title="drafts"
          action={returnPath && <a className="profile-edit-link" href={returnPath}>back</a>} />
        {drafts.length === 0
          ? <p className="drafts-empty">You don’t have any drafts. <a href="/">Back to the homepage</a>.</p>
          : drafts.map(draft => (
            <Post key={draft.id} p={{
              id: -draft.id,
              user_id: user.id,
              parent_id: draft.parent_id,
              body: draft.body,
              created_at: draft.updated_at,
              deleted_at: null,
              handle: user.handle,
              bio: user.bio,
              parent: draft.parent,
            }} user={user} className="draft-post" showReplyAction={false} tappableParent topActions={
              <span className="post-actions">
                <a className="quiet" href={`/drafts/${draft.id}/edit${editFrom}`}>edit</a>
                <a className="quiet danger" href={`/drafts/${draft.id}/delete${editFrom}`}>delete</a>
              </span>
            } />
          ))}
      </div>
    </Layout>
  )
}

export function ConfirmDraftDelete({ user, draft, returnPath }: {
  user: User
  draft: DraftView
  returnPath?: string
}) {
  const draftsPath = `/drafts${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}`
  return (
    <Layout user={user} title="delete draft">
      <CenteredPanel shellClassName="auth-shell account-delete-shell post-delete-shell"
        className="auth-panel account-delete-panel confirm-delete post-delete-panel" width="medium" tone="danger"
      >
        <p className="eyebrow">draft deletion</p>
        <h1>Delete this draft?</h1>
        <p className="account-delete-copy">This can’t be undone.</p>
        <blockquote aria-label="Draft to delete">{displayPostBody(draft.body)}</blockquote>
        <form className="post-delete-form" method="post" action={`/drafts/${draft.id}/delete`}>
          {returnPath && <input type="hidden" name="from" value={returnPath} />}
          <FormActions
            secondary={<a className="secondary-action cancel-action" href={draftsPath}>cancel</a>}
            primary={<button className="button button-danger" type="submit">delete draft</button>}
          />
        </form>
      </CenteredPanel>
    </Layout>
  )
}
