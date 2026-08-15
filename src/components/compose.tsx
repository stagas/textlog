import { type User } from '../db'
import { canPublishPosts } from '../posting-policy'
import type { PostView } from '../types'
import { Layout } from './layout'
import { Panel } from './panel'
import {
  FormActions,
  FormMessage,
  PostingHelp,
  PostingSuggestionResults,
  type PostingSuggestionSearch,
  VerificationRequired,
} from './page-shared'
import { Post } from './post'

export function Compose(
  { user, error, body = '', preview = false, returnPath = '/', suggestionSearch }: {
    user: User
    error?: string
    body?: string
    preview?: boolean
    returnPath?: string
    suggestionSearch?: PostingSuggestionSearch | null
  },
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
      <Panel className="compose write-compose">
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
          <input type="hidden" name="from" value={returnPath} />
          <FormMessage error={error} />
          <textarea className="form-control" name="body" maxLength={280} required autoFocus defaultValue={body}
            autoComplete="off" inputMode="text" enterKeyHint="enter" />
          <PostingSuggestionResults search={suggestionSearch} />
          <div className="composefoot">
            <PostingHelp search={suggestionSearch} />
            <FormActions secondary={
              <span className="edit-post-actions">
                <a className="secondary-action cancel-action edit-post-cancel" href={returnPath}>cancel</a>
                <button className="secondary-action" name="action" value="preview">preview</button>
              </span>
            } primary={<button className="button">post →</button>} />
          </div>
        </form>
      </Panel>
    </Layout>
  )
}
