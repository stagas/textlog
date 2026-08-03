import { type User } from '../db'
import type { PostRow } from '../types'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function EditPost(
  { user, post, error, body = post.body }: { user: User; post: PostRow; error?: string; body?: string },
) {
  return (
    <Layout user={user} title="edit post">
      <div className="panel compose">
        <form method="post" action={'/post/' + post.id + '/edit'}>
          <FormMessage error={error} />
          <textarea name="body" maxLength={280} required autoFocus defaultValue={body} />
          <div className="composefoot">
            <span>280 characters max</span>
            <div className="form-actions">
              <a className="quiet" href={'/post/' + post.id}>cancel</a>
              <button className="button">save changes →</button>
            </div>
          </div>
        </form>
      </div>
    </Layout>
  )
}
