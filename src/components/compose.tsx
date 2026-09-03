import { POST_MAX } from '../post-body'
import { canPublishPosts } from '../posting-policy'
import type { User } from '../types'
import type { LocationView, PostView } from '../types'
import { Layout } from './layout'
import {
  FormActions,
  FormMessage,
  PostingHelp,
  PostingHelpAction,
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
      {preview && <ComposePreview user={user} body={body} executionOutput={previewExecutionOutput}
        location={previewLocation} />}
      <WriteForm user={user} error={error} body={body} returnPath={returnPath} suggestionSearch={suggestionSearch}
        draftId={draftId} autoFocus />
    </Layout>
  )
}

export function AnonymousCompose({ body = '', error, preview = false, previewExecutionOutput, previewLocation,
  returnPath = '/' }: {
    body?: string
    error?: string
    preview?: boolean
    previewExecutionOutput?: string | null
    previewLocation?: LocationView
    returnPath?: string
  }) {
  return (
    <Layout title="write">
      {preview && <ComposePreview user={null} body={body} executionOutput={previewExecutionOutput}
        location={previewLocation} />}
      <AnonymousWriteForm body={body} error={error} returnPath={returnPath} />
    </Layout>
  )
}

export function ComposePreview({ user, body, executionOutput, location }: {
  user: User | null
  body: string
  executionOutput?: string | null
  location?: LocationView
}) {
  return (
    <div className="compose-post-preview">
      <h2>preview</h2>
      <Post p={{
        id: 0,
        user_id: user?.id ?? -1,
        parent_id: null,
        body,
        execution_output: executionOutput,
        location,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        deleted_at: null,
        handle: user?.handle ?? '',
        bio: user?.bio,
        mood: user?.mood,
      } satisfies PostView} user={user} replyHref={user ? '#' : undefined} preview hideTopMeta={!user} />
    </div>
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
  const helpId = embedded ? 'embedded-posting-help' : 'write-posting-help'
  const moreActions = (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        title="Enrich post with hashtags">
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview"
        title="Preview this post before publishing">preview</button>
      <button className="secondary-action" name="action" value="draft"
        title="Save this post as a draft" formAction={draftId ? `/drafts/${draftId}` : undefined}>
        draft
      </button>
    </>
  )
  const controls = (
    <div className="composefoot">
      <PostingHelp search={suggestionSearch} controlledBy={helpId} actions={moreActions} />
      <FormActions secondary={
        <span className="edit-post-actions">
          <PostingHelpAction id={helpId} defaultChecked={!!suggestionSearch} />
        </span>
      } primary={<button className="button" accessKey="p" title="Publish this post">post →</button>} />
    </div>
  )
  return (
    <Panel className={`compose write-compose${embedded ? ' embedded-write-compose' : ''}`}>
      <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        {embedded && <input type="hidden" name="embedded" value="1" />}
        {draftId && <input type="hidden" name="draft_id" value={draftId} />}
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX} autoFocus={autoFocus}
            accessKey={embedded ? 'w' : undefined}
            defaultValue={body} placeholder={`What’s on your mind, @${user.handle}?`}
            aria-label={`What’s on your mind, @${user.handle}?`}
            autoComplete="off" inputMode="text" enterKeyHint="enter" />
          <PostingSuggestionResults search={suggestionSearch} />
          {controls}
        </div>
      </form>
    </Panel>
  )
}

export function AnonymousWriteForm({ returnPath = '/', error, body = '' }: {
  returnPath?: string
  error?: string
  body?: string
}) {
  const helpId = 'anonymous-posting-help'
  const moreActions = (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        title="Enrich post with hashtags">
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview"
        title="Preview this post before publishing">preview</button>
      <button className="secondary-action" name="action" value="draft"
        title="Save this post as a draft">draft</button>
    </>
  )
  return (
    <Panel className="compose write-compose embedded-write-compose anonymous-write-compose">
      <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        <input type="hidden" name="embedded" value="1" />
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX}
            defaultValue={body}
            placeholder="What's on your mind?" aria-label="What's on your mind?"
            autoComplete="off" inputMode="text" enterKeyHint="enter" />
          <div className="composefoot">
            <PostingHelp controlledBy={helpId} actions={moreActions} />
            <FormActions secondary={
              <span className="edit-post-actions"><PostingHelpAction id={helpId} /></span>
            } primary={<button className="button" title="Join and publish this post">post →</button>} />
          </div>
        </div>
      </form>
    </Panel>
  )
}
