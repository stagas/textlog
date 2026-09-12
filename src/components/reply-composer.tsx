import type React from 'preact/compat'
import { POST_MAX, POST_MAX_LINES } from '../post-body'
import { activeRequest } from '../theme'
import type { User } from '../types'
import { isMobileRequest } from '../user-agent'
import {
  FormActions,
  FormMessage,
  PostingHelp,
  PostingHelpAction,
  PostingSuggestionResults,
  type PostingSuggestionSearch,
} from './page-shared'
import { Panel } from './panel'

export function ReplyBox(
  { action, body, error, placeholder, hidden, beforeTextarea, secondary, primary, moreActions,
    className = 'replybox reply-compose', suggestionSearch, draftId, helpId = 'reply-posting-help', autoFocus = true,
    storageKey }: {
      action: string
      body: string
      error?: string
      placeholder?: string
      hidden?: React.ReactNode
      beforeTextarea?: React.ReactNode
      secondary: React.ReactNode
      primary: React.ReactNode
      moreActions?: React.ReactNode
      className?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      helpId?: string
      autoFocus?: boolean
      storageKey?: string
    },
) {
  const shouldAutoFocus = autoFocus && !isMobileRequest(activeRequest())
  return (
    <>
      <Panel className={className}>
        <form method="post" action={action}>
          {hidden}
          {draftId && <input type="hidden" name="draft_id" value={draftId} />}
          <FormMessage error={error} />
          {beforeTextarea}
          <div className="compose-editor-row">
            <textarea className="form-control" name="body" data-character-limit={POST_MAX}
              data-auto-focus={shouldAutoFocus ? '' : undefined} data-compose-storage-key={storageKey}
              data-line-limit={POST_MAX_LINES} style={{ '--compose-max-lines': POST_MAX_LINES } as React.CSSProperties}
              defaultValue={body} placeholder={placeholder} autoComplete="off" inputMode="text" enterkeyhint="enter" />
            <PostingSuggestionResults search={suggestionSearch} />
            <div className="composefoot">
              <PostingHelp search={suggestionSearch} controlledBy={helpId} actions={moreActions} />
              <div className="compose-controls-row">
                <output className="compose-character-count" hidden aria-live="polite" />
                <FormActions secondary={secondary} primary={primary} />
              </div>
            </div>
          </div>
        </form>
      </Panel>
      <script src="/compose.js?v=25" defer />
    </>
  )
}

export function ReplyComposer(
  { user, replyParent, replyPageId, returnPath, inline = false, body = '', error, suggestionSearch, draftId,
    autoFocus = true }: {
      user: User | null
      replyParent: { id: number; user_id: number; handle: string }
      replyPageId: number
      returnPath?: string
      inline?: boolean
      body?: string
      error?: string
      suggestionSearch?: PostingSuggestionSearch | null
      draftId?: string
      autoFocus?: boolean
    },
) {
  const helpId = user ? 'reply-posting-help' : 'anonymous-reply-posting-help'
  return (
    <ReplyBox action={`/post/${replyParent.id}/reply#post-${replyParent.id}`} body={body} error={error}
      suggestionSearch={suggestionSearch} draftId={draftId}
      placeholder={user && replyParent.user_id === user.id ? 'Continue writing…' : `Reply to @${replyParent.handle}…`}
      className={`replybox reply-compose${inline ? '' : ' root-reply-compose'}${
        user ? '' : ' anonymous-reply-compose'
      }`} autoFocus={autoFocus} hidden={
      <>
        <input type="hidden" name="reply_page_id" value={replyPageId} />
        {returnPath && <input type="hidden" name="from" value={returnPath} />}
      </>
    } helpId={helpId} storageKey={`textlog:compose:${user?.id ?? 'guest'}:reply:${replyParent.id}`}
      secondary={
        <span className="edit-post-actions">
          <PostingHelpAction id={helpId} defaultChecked={!!suggestionSearch} />
        </span>
      } primary={<button className="button" accessKey={user ? 'p' : undefined}>post →</button>} moreActions={
      <ComposeMoreActions>
        <button className="secondary-action" name="action" value="draft"
          formAction={draftId ? `/drafts/${draftId}` : undefined}
        >
          draft
        </button>
      </ComposeMoreActions>
    } />
  )
}

export function ComposeMoreActions({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <button className="secondary-action compose-autotag-action" name="action" value="autotag"
        title="Enrich post with hashtags"
      >
        autotag
      </button>
      <button className="secondary-action" name="action" value="preview">preview</button>
      {children}
    </>
  )
}
