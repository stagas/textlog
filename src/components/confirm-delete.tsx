import { type User } from '../db'
import type { PostRow } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'

export function ConfirmDelete({ user, post }: { user: User; post: PostRow }) {
  return (
    <Layout user={user} title="delete post">
      <div className="panel confirm-delete">
        <h1>Delete this post?</h1>
        <p>Its replies will remain, with this post shown as “(deleted)” when quoted.</p>
        <blockquote>{post.body}</blockquote>
        <FormActions secondary={<a className="secondary-action" href={'/post/' + post.id}>cancel</a>}
          primary={<form method="post" action={'/post/' + post.id + '/delete'}>
            <button className="button button-danger" type="submit">delete post</button>
          </form>} />
      </div>
    </Layout>
  )
}
