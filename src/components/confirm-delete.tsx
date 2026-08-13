import { type User } from '../db'
import type { PostRow } from '../types'
import { displayPostBody } from '../utils'
import { Layout } from './layout'
import { FormActions } from './page-shared'

export function ConfirmDelete({ user, post, returnPath }: { user: User; post: PostRow; returnPath?: string }) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return (
    <Layout user={user} title="delete post">
      <section className="auth-shell account-delete-shell post-delete-shell">
        <div className="panel auth-panel account-delete-panel confirm-delete post-delete-panel">
          <p className="eyebrow">note deletion</p>
          <h1>Delete this post?</h1>
          <p className="account-delete-copy">
            This can’t be undone. Replies will remain, with this post shown as “(deleted)” where the conversation needs
            it.
          </p>
          <blockquote aria-label="Post to delete">{displayPostBody(post.body)}</blockquote>
          <form className="post-delete-form" method="post" action={'/post/' + post.id + '/delete'}>
            {returnPath && <input type="hidden" name="from" value={returnPath} />}
            <FormActions
              secondary={<a className="secondary-action" href={'/post/' + post.id + returnQuery}>cancel</a>}
              primary={<button className="button button-danger" type="submit">delete post</button>}
            />
          </form>
        </div>
      </section>
    </Layout>
  )
}
