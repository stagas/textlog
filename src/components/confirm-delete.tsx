import { type User } from '../db'
import type { PostRow } from '../types'
import { Layout } from './layout'

export function ConfirmDelete({ user, post }: { user: User; post: PostRow }) {
  return (
    <Layout user={user} title="delete post">
      <div className="panel confirm-delete">
        <h1>Delete this post?</h1>
        <p>Its replies will remain, with this post shown as “(deleted)” when quoted.</p>
        <blockquote>{post.body}</blockquote>
        <div className="form-actions">
          <a className="quiet" href={'/post/' + post.id}>cancel</a>
          <form method="post" action={'/post/' + post.id + '/delete'}>
            <button className="button delete-button" type="submit">delete post</button>
          </form>
        </div>
      </div>
    </Layout>
  )
}
