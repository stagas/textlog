import { type User } from '../db'
import { canPublishPosts } from '../posting-policy'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FormMessage, VerificationRequired } from './page-shared'
import { Post } from './post'

export function Compose(
  { user, error, body = '', preview = false }: { user: User; error?: string; body?: string; preview?: boolean },
) {
  if (!canPublishPosts(user)) {
    return (
      <Layout user={user} title="write">
        <VerificationRequired />
      </Layout>
    )
  }
  return (
    <Layout user={user} title="write">
      <div className="panel compose write-compose">
        {preview && (
          <div className="compose-post-preview">
            <h2>preview</h2>
            <Post p={{
              id: 0,
              user_id: user.id,
              parent_id: null,
              body,
              created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
              deleted_at: null,
              handle: user.handle,
              bio: user.bio,
            } satisfies PostView} user={user} replyHref="#" preview />
          </div>
        )}
        <h1 className="compose-heading">
          What's on your mind, <span className="compose-at">@</span>
          {user.handle}?
        </h1>
        <form method="post" action="/post">
          <FormMessage error={error} />
          <textarea name="body" maxLength={280} required autoFocus defaultValue={body} />
          <div className="composefoot">
            <span>280 characters max · use #hashtags and @mentions</span>
            <div className="form-actions">
              <button className="quiet" name="action" value="preview">preview</button>
              <button className="button">post →</button>
            </div>
          </div>
        </form>
      </div>
    </Layout>
  )
}
