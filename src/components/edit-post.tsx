import { type User } from '../db'
import type { PostRow } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'

export function EditPost(
  { user, post, error, body = post.body }: { user: User; post: PostRow; error?: string; body?: string },
) {
  return (
    <Layout user={user} title="edit post">
      <div className="panel compose">
        <form method="post" action={'/post/' + post.id + '/edit'}>
          <FormMessage error={error} />
          <textarea className="form-control" name="body" maxLength={280} required autoFocus defaultValue={body} />
          <div className="composefoot">
            <span>280 characters max · use #hashtags and @mentions</span>
            <FormActions secondary={<a className="secondary-action" href={'/post/' + post.id}>cancel</a>}
              primary={<button className="button">save changes →</button>} />
          </div>
        </form>
      </div>
    </Layout>
  )
}
