import { POST_MAX, POST_MAX_LINES } from '../post-body'
import { canPublishPosts } from '../posting-policy'
import { appName } from '../brand'
import { activeRequest, activeThemeLogoSvg } from '../theme'
import { composePlaceholders, randomComposePlaceholder } from '../compose-placeholders'
import type { User } from '../types'
import type { LocationView, PostView } from '../types'
import { isMobileRequest } from '../user-agent'
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
      <Layout user={user} title="write" fullScreen fullScreenScrollable>
        <WritePageShell returnPath={returnPath}>
          <VerificationRequired />
        </WritePageShell>
      </Layout>
    )
  }
  return (
    <Layout user={user} title="write" fullScreen fullScreenScrollable>
      <WritePageShell returnPath={returnPath}>
        {preview && (
          <ComposePreview user={user} body={body} executionOutput={previewExecutionOutput} location={previewLocation} />
        )}
        <WriteForm user={user} error={error} body={body} returnPath={returnPath}
          suggestionSearch={suggestionSearch} draftId={draftId} autoFocus={!preview} embedded standalone
          showBack={showBack} />
      </WritePageShell>
    </Layout>
  )
}

function WritePageShell({ returnPath, children }: { returnPath: string; children: React.ReactNode }) {
  const name = appName()
  return (
    <section className="write-page-shell">
      <div className="write-page-bar">
        <a className="brand" href="/" aria-label={`${name} home`}>
          <span className="brand-logo" aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: activeThemeLogoSvg() }} />
          <span>{name}</span>
        </a>
        <a className="profile-edit-link compose-back-link" href={returnPath}>back</a>
      </div>
      <div className="write-page-content">{children}</div>
    </section>
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
    standalone = false, showBack = false }: {
      user: User
      error?: string
      body?: string
      returnPath?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      autoFocus?: boolean
      embedded?: boolean
      standalone?: boolean
      showBack?: boolean
    },
) {
  if (!canPublishPosts(user)) return null
  const shouldAutoFocus = (autoFocus || embedded) && !isMobileRequest(activeRequest())
  const storageKey = `textlog:compose:${user.id}:write`
  const placeholder = randomComposePlaceholder(user.handle)
  const typewriterPlaceholders = JSON.stringify(composePlaceholders(user.handle))
  const helpId = embedded ? 'embedded-posting-help' : 'write-posting-help'
  const moreActions = (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        formAction={embedded && !standalone ? returnPath : undefined}
        title="Enrich post with hashtags"
      >
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview"
        formAction={embedded && !standalone ? returnPath : undefined}
        title="Preview this post before publishing"
      >
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
      <div className="compose-controls-row">
        <output className="compose-character-count" hidden aria-live="polite" />
        <FormActions secondary={
          <span className="edit-post-actions">
            <PostingHelpAction id={helpId} defaultChecked={!!suggestionSearch} />
          </span>
        } primary={<button className="button" accessKey="p" title="Publish this post">post →</button>} />
      </div>
    </div>
  )
  return (
    <>
      <Panel className={`compose write-compose${embedded ? ' embedded-write-compose' : ''}`}>
        <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        {showBack && <input type="hidden" name="show_back" value="1" />}
        {embedded && !standalone && <input type="hidden" name="embedded" value="1" />}
        {draftId && <input type="hidden" name="draft_id" value={draftId} />}
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" data-character-limit={POST_MAX}
            data-auto-focus={shouldAutoFocus ? '' : undefined}
            data-compose-storage-key={storageKey}
            data-line-limit={POST_MAX_LINES} style={{ '--compose-max-lines': POST_MAX_LINES } as React.CSSProperties}
            accessKey={embedded ? 'w' : undefined} defaultValue={body}
            placeholder={embedded ? placeholder : undefined}
            aria-label={`What’s on your mind, @${user.handle}?`} autoComplete="off" inputMode="text"
            enterkeyhint="enter" />
          <PostingSuggestionResults search={suggestionSearch} />
          {controls}
        </div>
        </form>
      </Panel>
      <script src="/compose.js?v=8" data-typewriter-placeholders={typewriterPlaceholders} defer />
    </>
  )
}

export function AnonymousWriteForm({ returnPath = '/', error, body = '' }: {
  returnPath?: string
  error?: string
  body?: string
}) {
  const autoFocus = !isMobileRequest(activeRequest())
  const storageKey = 'textlog:compose:guest:write'
  const typewriterPlaceholders = JSON.stringify(composePlaceholders())
  const helpId = 'anonymous-posting-help'
  const moreActions = (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        formAction={returnPath}
        title="Enrich post with hashtags"
      >
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview" formAction={returnPath}
        title="Preview this post before publishing"
      >
        preview
      </button>
      <button className="secondary-action" name="action" value="draft" title="Save this post as a draft">draft</button>
    </>
  )
  return (
    <>
      <Panel className="compose write-compose embedded-write-compose anonymous-write-compose">
        <form method="post" action="/post">
        <input type="hidden" name="from" value={returnPath} />
        <input type="hidden" name="embedded" value="1" />
        <FormMessage error={error} />
        <div className="compose-editor-row">
          <textarea className="form-control" name="body" data-character-limit={POST_MAX}
            data-auto-focus={autoFocus ? '' : undefined} data-compose-storage-key={storageKey} defaultValue={body}
            data-line-limit={POST_MAX_LINES} style={{ '--compose-max-lines': POST_MAX_LINES } as React.CSSProperties}
            placeholder="What's on your mind?" aria-label="What's on your mind?" autoComplete="off" inputMode="text"
            enterkeyhint="enter" />
          <div className="composefoot">
            <PostingHelp controlledBy={helpId} actions={moreActions} />
            <div className="compose-controls-row">
              <output className="compose-character-count" hidden aria-live="polite" />
              <FormActions secondary={
                <span className="edit-post-actions">
                  <PostingHelpAction id={helpId} />
                </span>
              } primary={<button className="button" title="Join and publish this post">post →</button>} />
            </div>
          </div>
        </div>
        </form>
      </Panel>
      <script src="/compose.js?v=8" data-typewriter-placeholders={typewriterPlaceholders} defer />
    </>
  )
}
