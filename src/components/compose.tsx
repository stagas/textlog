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
    suggestionSearch, draftId, showBack = false }: {
      user: User
      error?: string
      body?: string
      preview?: boolean
      previewExecutionOutput?: string | null
      previewLocation?: LocationView
      returnPath?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      showBack?: boolean
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
        <ComposePreview user={user} body={body} executionOutput={previewExecutionOutput} location={previewLocation}
          backPath={showBack ? returnPath : undefined} />
      )}
      {!preview && (
        <div className={`page-header compose-heading-row${showBack ? ' compose-heading-row-with-back' : ''}`}>
          <h2>
            What’s on your mind, <span className="compose-heading-at">@</span>
            {user.handle}?
          </h2>
          {showBack && <a className="profile-edit-link compose-back-link" href={returnPath}>back</a>}
        </div>
      )}
      <WriteForm user={user} error={error} body={body} returnPath={returnPath} suggestionSearch={suggestionSearch}
        draftId={draftId} autoFocus showBack={showBack} />
    </Layout>
  )
}

export function AnonymousCompose(
  { body = '', error, preview = false, previewExecutionOutput, previewLocation, returnPath = '/' }: {
    body?: string
    error?: string
    preview?: boolean
    previewExecutionOutput?: string | null
    previewLocation?: LocationView
    returnPath?: string
  },
) {
  return (
    <Layout title="write">
      {preview && (
        <ComposePreview user={null} body={body} executionOutput={previewExecutionOutput} location={previewLocation} />
      )}
      <AnonymousWriteForm body={body} error={error} returnPath={returnPath} />
    </Layout>
  )
}

export function ComposePreview({ user, body, executionOutput, location, backPath }: {
  user: User | null
  body: string
  executionOutput?: string | null
  location?: LocationView
  backPath?: string
}) {
  return (
    <div className={`compose-post-preview${backPath ? ' compose-post-preview-with-back' : ''}`}>
      <div className="compose-preview-heading">
        <h2>preview</h2>
        {backPath && <a className="profile-edit-link compose-back-link" href={backPath}>back</a>}
      </div>
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
  { user, error, body = '', returnPath = '/', suggestionSearch, draftId, autoFocus = false, embedded = false,
    showBack = false }: {
      user: User
      error?: string
      body?: string
      returnPath?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      autoFocus?: boolean
      embedded?: boolean
      showBack?: boolean
    },
) {
  if (!canPublishPosts(user)) return null
  const helpId = embedded ? 'embedded-posting-help' : 'write-posting-help'
  const moreActions = (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        title="Enrich post with hashtags"
      >
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview"
        formAction={embedded ? returnPath : undefined} title="Preview this post before publishing">
        preview
      </button>
      <button className="secondary-action" name="action" value="draft" title="Save this post as a draft"
        formAction={draftId ? `/drafts/${draftId}` : undefined}
      >
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
        {showBack && <input type="hidden" name="show_back" value="1" />}
        {embedded && <input type="hidden" name="embedded" value="1" />}
        {draftId && <input type="hidden" name="draft_id" value={draftId} />}
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX} autoFocus={autoFocus}
            accessKey={embedded ? 'w' : undefined} defaultValue={body}
            placeholder={embedded ? `What’s on your mind, @${user.handle}?` : undefined}
            aria-label={`What’s on your mind, @${user.handle}?`} autoComplete="off" inputMode="text"
            enterkeyhint="enter" />
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
        title="Enrich post with hashtags"
      >
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview" formAction={returnPath}
        title="Preview this post before publishing">
        preview
      </button>
      <button className="secondary-action" name="action" value="draft" title="Save this post as a draft">draft</button>
    </>
  )
  return (
    <Panel className="compose write-compose embedded-write-compose anonymous-write-compose">
      <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        <input type="hidden" name="embedded" value="1" />
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" maxLength={POST_MAX} defaultValue={body}
            placeholder="What's on your mind?" aria-label="What's on your mind?" autoComplete="off" inputMode="text"
            enterkeyhint="enter" />
          <div className="composefoot">
            <PostingHelp controlledBy={helpId} actions={moreActions} />
            <FormActions secondary={
              <span className="edit-post-actions">
                <PostingHelpAction id={helpId} />
              </span>
            } primary={<button className="button" title="Join and publish this post">post →</button>} />
          </div>
        </div>
      </form>
    </Panel>
  )
}
