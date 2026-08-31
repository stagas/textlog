import { POST_MAX } from '../post-body'
import { canPublishPosts } from '../posting-policy'
import type { User } from '../types'
import type { LocationView, PostView } from '../types'
import { Layout } from './layout'
import {
  FormActions,
  FormMessage,
  PostingHelp,
  PostingSuggestionResults,
  type PostingSuggestionSearch,
  VerificationRequired,
} from './page-shared'
import { Panel } from './panel'
import { Post } from './post'

export function Compose(
  { user, error, body = '', preview = false, previewExecutionOutput, previewLocation, returnPath = '/',
    suggestionSearch, draftId }: {
    user: User
    error?: string
    body?: string
    preview?: boolean
    previewExecutionOutput?: string | null
    previewLocation?: LocationView
    returnPath?: string
    suggestionSearch?: PostingSuggestionSearch | null
    draftId?: string
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
      {preview && (
        <div className="compose-post-preview">
          <h2>preview</h2>
          <Post p={{
            id: 0,
            user_id: user.id,
            parent_id: null,
            body,
            execution_output: previewExecutionOutput,
            location: previewLocation,
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            deleted_at: null,
            handle: user.handle,
            bio: user.bio,
          } satisfies PostView} user={user} replyHref="#" preview />
        </div>
      )}
      <WriteForm user={user} error={error} body={body} returnPath={returnPath} suggestionSearch={suggestionSearch}
        draftId={draftId} autoFocus />
    </Layout>
  )
}

export function WriteForm(
  { user, error, body = '', returnPath = '/', suggestionSearch, draftId, autoFocus = false, embedded = false }: {
    user: User
    error?: string
    body?: string
    returnPath?: string
    suggestionSearch?: PostingSuggestionSearch | null
    draftId?: string
    autoFocus?: boolean
    embedded?: boolean
  },
) {
  if (!canPublishPosts(user)) return null
  const controls = (
    <div className="composefoot">
      <PostingHelp search={suggestionSearch} />
      <FormActions secondary={
        <span className="edit-post-actions">
          <a className="secondary-action cancel-action edit-post-cancel" href={returnPath}>cancel</a>
          <button className="secondary-action" name="action" value="preview">preview</button>
          <button className="secondary-action" name="action" value="draft"
            formAction={draftId ? `/drafts/${draftId}` : undefined}
          >
            draft
          </button>
        </span>
      } primary={<button className="button" accessKey="p">post →</button>} />
    </div>
  )
  return (
    <Panel className={`compose write-compose${embedded ? ' embedded-write-compose' : ''}`}>
      {!embedded && (
        <h1 className="compose-heading">
          What’s on your mind, <span className="compose-at">@</span>
          {user.handle}?
        </h1>
      )}
      <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        {draftId && <input type="hidden" name="draft_id" value={draftId} />}
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX} required autoFocus={autoFocus}
            defaultValue={body} placeholder={embedded ? `What’s on your mind, @${user.handle}?` : undefined}
            aria-label={embedded ? `What’s on your mind, @${user.handle}?` : undefined}
            autoComplete="off" inputMode="text" enterKeyHint="enter" />
          {embedded && <PostingSuggestionResults search={suggestionSearch} />}
          {embedded && controls}
        </div>
        {!embedded && <PostingSuggestionResults search={suggestionSearch} />}
        {!embedded && controls}
      </form>
    </Panel>
  )
}
