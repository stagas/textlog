import type { BioReferenceData, PersonView, PostView, ProfileRow, TagView } from '../types'
import { displayBio, linkify } from '../utils'
import { BioReferenceForms, TagReference, UserReference } from './post'

import { randomInt } from 'node:crypto'
import React from 'react'
import { isAdmin } from '../admin'
import { markdownPlainText } from '../markdown'
import { moderatedContentDescription } from '../moderation'
import { searchTerms } from '../search'
import { activeRequest } from '../theme'
import type { User } from '../types'
import { isMobileRequest } from '../user-agent'
import { enterHref } from './auth-links'
import { Panel } from './panel'
import { writeHref } from './write-link'

const postTitleLength = 60

export function paginationHeadingClass() {
  return `explore-section-heading${isMobileRequest(activeRequest()) ? ' explore-section-heading-mobile' : ''}`
}

export function TabHighlight({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <svg className="feed-tab-highlight" viewBox="0 0 100 2" preserveAspectRatio="none" shapeRendering="crispEdges"
      aria-hidden="true" focusable="false"
    >
      <rect width="100" height="2" />
    </svg>
  )
}

export function postTitle(body: string, moderationCategory?: string | null) {
  const text = moderationCategory ? moderatedContentDescription(moderationCategory) : markdownPlainText(body)
  const characters = Array.from(text)
  return characters.length > postTitleLength
    ? `${characters.slice(0, postTitleLength - 1).join('').trimEnd()}…`
    : text
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null
  return (
    <p className={`status-message ${error ? 'status-error' : 'status-success'}`} role={error ? 'alert' : 'status'}>
      {error || success}
    </p>
  )
}

export function FormActions({ primary, secondary, className = '' }: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`form-actions${className ? ` ${className}` : ''}`}>
      {secondary && <span className="form-actions-secondary">{secondary}</span>}
      {primary}
    </div>
  )
}

export type PostingSuggestionSearch = {
  kind: 'hashtags' | 'mentions'
  query: string
  results: string[]
  truncated?: boolean
}

function PostingSuggestionSearchField({ kind, search }: {
  kind: PostingSuggestionSearch['kind']
  search?: PostingSuggestionSearch | null
}) {
  const active = search?.kind === kind
  const inputName = kind === 'hashtags' ? 'hashtag_query' : 'mention_query'
  const searchLabel = kind === 'hashtags' ? 'hashtags' : 'handles'
  return (
    <div className="posting-help-search">
      <input type="search" name={inputName} aria-label={`Search ${searchLabel}`} maxLength={100}
        defaultValue={active ? search.query : ''} placeholder={`search ${searchLabel}`} autoComplete="off"
        inputMode="search" enterKeyHint="search" />
      <button className="button" type="submit" name="action" value={`search-${kind}`} formNoValidate>
        search
      </button>
    </div>
  )
}

function PostingHelpTabs({ search }: { search?: PostingSuggestionSearch | null }) {
  const tabId = React.useId()
  return (
    <section className="posting-help-tabs-section">
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-emoji`}
        defaultChecked={!search} />
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-formatting`} />
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-modifiers`} />
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-search`}
        defaultChecked={!!search} />
      <nav className="posting-help-tabs" aria-label="Writing help">
        <label htmlFor={`${tabId}-emoji`}>emoji</label>
        <label htmlFor={`${tabId}-formatting`}>formatting</label>
        <label htmlFor={`${tabId}-modifiers`}>tags</label>
        <label htmlFor={`${tabId}-search`}>search</label>
      </nav>
      <div className="posting-help-emoji-panel posting-help-tab-panel" aria-label="Emoji to copy and paste">
        {'😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 ☠️ 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 👏 🙌 🫶 👐 🤲 🙏 ✍️ 💪 👀 👁️ 🧠 🫀 🫁 🌱 🌿 ☘️ 🍀 🌸 🌺 🌻 🌞 🌙 ⭐ ✨ ⚡ 🔥 🌈 ☀️ ☁️ ❄️ ☕ 🍕 🍎 🎉 🎊 🎈 🎁 🎵 🎶 🎨 📚 💡 ✅ ❌ ⚠️ 🚀 🌍 💻 📱 🔒 🔑'
          .split(' ').map((emoji, index) => <span key={`${emoji}-${index}`} title="Select and copy">{emoji}</span>)}
      </div>
      <dl className="posting-help-formatting-panel posting-help-tab-panel">
        <div>
          <dd>
            <code>
              <span className="posting-help-link">example.com</span> or
              <br />
              <span className="posting-help-link">https://example.com</span>
            </code>
          </dd>
          <dt>Regular links</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>[</b>title<b>](</b>example.com<b>)</b> or
              <br />
              <b>[</b>title<b>](</b>https://example.com<b>)</b>
            </code>
          </dd>
          <dt>Markdown links</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>~</b>text<b>~</b> or <b>~~</b>text<b>~~</b>
            </code>
          </dd>
          <dt>Strikethrough</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>*</b>text<b>*</b> or <b>**</b>text<b>**</b>
            </code>
          </dd>
          <dt>Bold</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>_</b>text<b>_</b> or <b>__</b>text<b>__</b>
            </code>
          </dd>
          <dt>Underline</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>/</b>text<b>/</b>
            </code>
          </dd>
          <dt>Italics</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>&gt;</b> text
            </code>
          </dd>
          <dt>Quote</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>1.</b> first<br />
              <b>2.</b> second<br />
              <b>3.</b> third
            </code>
          </dd>
          <dt>Numbered lists</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>-</b> first<br />
              <b>-</b> second<br />
              <b>-</b> third
            </code>
          </dd>
          <dt>Bulleted lists</dt>
        </div>
        <div>
          <dd>
            <code>
              Name&nbsp; <b>|</b> Status <b>|</b> Count<br />
              ----- <b>|</b> :----- <b>|</b> ----:<br />
              notes <b>|</b> ready&nbsp; <b>|</b> &nbsp;&nbsp;&nbsp;&nbsp;3
            </code>
          </dd>
          <dt>Tables</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>|</b>redacted<b>|</b>
            </code>
          </dd>
          <dt>Redacted</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>`</b>code<b>`</b>
            </code>
          </dd>
          <dt>Inline code</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>```</b>…<b>```</b>
            </code>
          </dd>
          <dt>Code fences</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>$</b>inline<b>$</b>
            </code>
          </dd>
          <dt>Inline LaTeX</dt>
        </div>
        <div>
          <dd>
            <code>
              <b>$$</b>block<b>$$</b>
            </code>
          </dd>
          <dt>Block LaTeX</dt>
        </div>
      </dl>
      <dl className="posting-help-modifiers-panel posting-help-tab-panel">
        <div>
          <dd>
            <code>
              Which one? <b>#poll</b>
              <br />
              First option<br />
              Second option
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Polls</span>
            <small>Use 2–8 unique options.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Which one? <b>#quiz</b>
              <br />
              Wrong answer<br />
              <b>&gt;</b>Correct answer<br />
              <br />
              Explanation revealed after answering
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Quizzes</span>
            <small>
              Mark exactly one of 2–8 unique answers with &gt;. Text after a blank line is revealed after answering.
            </small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Visible text <b>#spoiler</b>
              <br />
              Hidden text
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Spoilers</span>
            <small>
              Text after #spoiler is hidden until revealed. Aliases: #tldr, #sensitive, #contentwarning, #cw, and
              #triggerwarning.
            </small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Going hiking <b>#map</b>
              <br />
              Kallikratis, Crete
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Maps</span>
            <small>Shows a map preview for the first location line. Alias: #location.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Today <b>#todo</b>
              <br />
              <b>[ ]</b> First task<br />
              <b>[x]</b> Finished task
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Todos</span>
            <small>Only [ ] and [x] lines become items. Click your items to toggle them.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Run this <b>#exec</b>
              <br />
              <b>```js</b>
              <br />
              console.log(6 * 7)<br />
              <b>```</b>
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Executable code</span>
            <small>Runs the next language-tagged code fence and shows its output beneath the note.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Keep this visible <b>#pin</b>
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Pinned notes</span>
            <small>Your latest #pin is shown first on your profile, independently for notes and replies.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              No more replies <b>#lock</b>
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Locked conversations</span>
            <small>Prevents new replies to this note and every reply beneath it.</small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              About textlog <b>#meta</b>
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Meta conversations</span>
            <small>
              Keeps this note and its replies out of public discovery feeds. Aliases: #tlog and #textlog.
            </small>
          </dt>
        </div>
        <div>
          <dd>
            <code>
              Continue quietly <b>#whisper</b>
            </code>
          </dd>
          <dt>
            <span className="posting-help-modifier-heading">Whisper conversations</span>
            <small>
              Keeps the branch out of all and hot. Participants, mentions, and tag followers can receive it in my feed.
              It remains public elsewhere.
            </small>
          </dt>
        </div>
      </dl>
      <div className="posting-help-search-panel posting-help-tab-panel">
        <div className="posting-help-searches">
          <PostingSuggestionSearchField kind="hashtags" search={search} />
          <PostingSuggestionSearchField kind="mentions" search={search} />
        </div>
      </div>
    </section>
  )
}

export function PostingHelp({ maxLength = 500, maxLines = 15, search, oneLine = false, controlledBy, actions }: {
  maxLength?: number
  maxLines?: number
  search?: PostingSuggestionSearch | null
  oneLine?: boolean
  controlledBy?: string
  actions?: React.ReactNode
}) {
  if (controlledBy) {
    return (
      <div className="posting-help posting-help-controlled">
        <div className="posting-help-content" id={`${controlledBy}-content`}>
          <div className="posting-help-controlled-summary">
            <span className="posting-help-limits">{maxLength} chars / {maxLines} lines max</span>
            {' · use #hashtags, @mentions and more'}
          </div>
          <PostingHelpTabs search={search} />
          {actions && <div className="posting-help-actions">{actions}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="posting-help">
      <details className="posting-help-details" open={!!search}>
        <summary aria-controls="posting-help-content">
          <span className="posting-help-summary-link">
            <span className="posting-help-limits">{maxLength} chars / {maxLines} lines max</span>
            {oneLine ? ' · ' : <br />}
            use #hashtags, @mentions and more
          </span>
        </summary>
      </details>
      <div className="posting-help-content" id="posting-help-content">
        <PostingHelpTabs search={search} />
      </div>
    </div>
  )
}

export function PostingHelpAction({ id, defaultChecked = false }: { id: string; defaultChecked?: boolean }) {
  return (
    <label className="secondary-action posting-help-action" htmlFor={id} title="Show more writing actions and help">
      <input className="posting-help-toggle" id={id} type="checkbox" aria-controls={`${id}-content`}
        defaultChecked={defaultChecked} />
      more
    </label>
  )
}

export function PostingSuggestionResults({ search }: { search?: PostingSuggestionSearch | null }) {
  if (!search) return null
  const prefix = search.kind === 'hashtags' ? '#' : '@'
  const terms = searchTerms(search.query)
  return (
    <div className="posting-suggestion-results" aria-live="polite">
      {search.results.length
        ? search.results.map(result => (
          <span className="posting-suggestion-result" key={result} title="Select and copy">
            {prefix}
            <HighlightedText text={result} terms={terms} />
          </span>
        ))
        : <span>No matching {search.kind}.</span>}
      {search.truncated && <span aria-label="More results">...</span>}
    </div>
  )
}

export function ActionPair({ primary, secondary, className = '' }: {
  primary: React.ReactNode
  secondary: React.ReactNode
  className?: string
}) {
  return (
    <div className={`action-pair${className ? ` ${className}` : ''}`}>
      {primary}
      <span className="action-separator">or</span>
      {secondary}
    </div>
  )
}

export function GuestCommunityActions({ className = '' }: { className?: string }) {
  return (
    <ActionPair className={className}
      primary={<a className="button" href="/enter" rel="nofollow">join the community</a>}
      secondary={<a href="/hot">browse more notes</a>} />
  )
}

export function VerificationRequired() {
  return (
    <Panel className="status-message status-error" role="alert">
      Confirm your email address before posting. <a href="/account/security">Verify your email</a>
    </Panel>
  )
}

export function Pagination(
  { page, totalPages, path, pageParam = 'page', label = 'Pagination', compact = false, top = false, anchor,
    instantScroll = false }: {
      page: number
      totalPages: number
      path: string
      pageParam?: string
      label?: string
      compact?: boolean
      top?: boolean
      anchor?: string
      instantScroll?: boolean
    },
) {
  if (totalPages <= 1) return null
  const separator = path.includes('?') ? '&' : '?'
  const [formPath, formQuery = ''] = path.split('?', 2)
  const formParameters = [...new URLSearchParams(formQuery)].filter(([name]) => name !== pageParam)
  const fragment = anchor ? `#${anchor}` : ''
  const pageHref = (value: number) =>
    `${path}${separator}${pageParam}=${value}${instantScroll ? '&_scroll=instant' : ''}${fragment}`
  const windowStart = Math.max(1, Math.min(page - 1, totalPages - 2))
  const windowPages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => windowStart + index)
  const pages = [...new Set([1, ...windowPages, totalPages])].sort((a, b) => a - b)
  return (
    <nav className={`pagination${compact ? ' pagination-compact' : ''}${top ? ' pagination-top' : ''}`}
      aria-label={label}
    >
      {page > 1
        ? (
          <a className="pagination-edge" href={pageHref(page - 1)} aria-label="Previous page">
            ← prev
          </a>
        )
        : <span className="pagination-edge placeholder" />}
      <div className="pagination-pages">
        {pages.map((value, index) => (
          <React.Fragment key={value}>
            {index > 0 && value - pages[index - 1] > 1
              && <span className="ellipsis" aria-hidden="true">…</span>}
            {value === page
              ? (
                <form className="pagination-current-form" method="get" action={`${formPath}${fragment}`}
                  aria-current="page"
                >
                  {formParameters.map(([name, parameterValue]) => (
                    <input key={`${name}:${parameterValue}`} type="hidden" name={name} value={parameterValue} />
                  ))}
                  {instantScroll && <input type="hidden" name="_scroll" value="instant" />}
                  <input className="current" aria-label={`Current page, ${page} of ${totalPages}`} type="number"
                    name={pageParam} min={1} max={totalPages} defaultValue={value} required autoComplete="off"
                    inputMode="numeric" enterKeyHint="go" />
                </form>
              )
              : (
                <a href={pageHref(value)} aria-label={`Page ${value}`}>
                  {value}
                </a>
              )}
          </React.Fragment>
        ))}
      </div>
      {page < totalPages
        ? (
          <a className="pagination-edge" href={pageHref(page + 1)} aria-label="Next page">
            next →
          </a>
        )
        : <span className="pagination-edge placeholder" />}
    </nav>
  )
}

export function CursorPagination({ path, previousCursor, nextCursor }: {
  path: string
  previousCursor: string | null
  nextCursor: string | null
}) {
  if (!previousCursor && !nextCursor) return null
  const separator = path.includes('?') ? '&' : '?'
  return (
    <nav className="pagination hot-pagination" aria-label="Pagination">
      {previousCursor
        ? (
          <a className="pagination-edge" href={`${path}${separator}cursor=${encodeURIComponent(previousCursor)}`}>
            ← prev
          </a>
        )
        : <span className="pagination-edge placeholder" />}
      {nextCursor
        ? (
          <a className="pagination-edge hot-pagination-next"
            href={`${path}${separator}cursor=${encodeURIComponent(nextCursor)}`}
          >
            next →
          </a>
        )
        : <span className="pagination-edge placeholder" />}
    </nav>
  )
}

function TabCount({ count }: { count: number }) {
  return count > 0 && <span className="to-me-count">{count >= 99 ? '99+' : count}</span>
}

export function FeedTabs(
  { active, user, forYouReadStatus, activityReadStatus, toMe = false, toMeCount = 0, forYouCount = 0, unreadHref,
    lastUnreadHref, forYouUnread = false, toMeUnread = false, latestCount = 0, readAction }: {
      active: 'following' | 'activity' | 'hot' | 'latest' | 'new' | 'random'
      user: User | null
      forYouReadStatus?: boolean
      activityReadStatus?: boolean
      toMe?: boolean
      toMeCount?: number
      forYouCount?: number
      unreadHref?: string
      lastUnreadHref?: string
      forYouUnread?: boolean
      toMeUnread?: boolean
      latestCount?: number
      readAction?: string
    },
) {
  const anySeed = randomInt(1, 2_147_483_647).toString(36)
  forYouUnread = forYouUnread || toMeUnread
  const hasDistinctLastUnread = !!lastUnreadHref && lastUnreadHref !== unreadHref
  return (
    <>
      <span className="feed-tabs-scroll-sentinel" aria-hidden="true" />
      <nav className="feed-tabs" id="feed-tabs" aria-label="Feed">
        <div className="feed-tabs-scroll">
          {user && (
            <a className={toMe ? 'active' : ''} aria-current={toMe ? 'page' : undefined} href="/@">
              <TabHighlight active={toMe} />
              @
              <TabCount count={toMeCount} />
            </a>
          )}
          {user && (
            <a className={active === 'following' && !toMe ? 'active' : ''}
              aria-current={active === 'following' && !toMe ? 'page' : undefined} href="/my-feed"
            >
              <TabHighlight active={active === 'following' && !toMe} />
              my feed
              <TabCount count={forYouCount} />
            </a>
          )}
          <a className={active === 'hot' ? 'active' : ''} aria-current={active === 'hot' ? 'page' : undefined}
            href="/hot"
          >
            <TabHighlight active={active === 'hot'} />
            hot
          </a>
          <a className={active === 'random' ? 'active' : ''} aria-current={active === 'random' ? 'page' : undefined}
            href={`/any?seed=${anySeed}`}
          >
            <TabHighlight active={active === 'random'} />
            any
          </a>
          <a className={active === 'new' ? 'active' : ''} aria-current={active === 'new' ? 'page' : undefined}
            href="/new"
          >
            <TabHighlight active={active === 'new'} />
            new
          </a>
          <a className={active === 'latest' ? 'active' : ''} aria-current={active === 'latest' ? 'page' : undefined}
            href="/all"
          >
            <TabHighlight active={active === 'latest'} />
            all
            <TabCount count={latestCount} />
          </a>
          {activityReadStatus !== undefined && (
            <span className="feed-tabs-read-status">
              {activityReadStatus !== undefined
                && (activityReadStatus
                  ? (
                    <form method="post" action="/activity/read-all">
                      <button className="activity-side-link">mark all as read</button>
                    </form>
                  )
                  : <span className="activity-side-status">you've seen it all</span>)}
            </span>
          )}
          <a className="feed-tabs-top" href="#" aria-label="Back to top" title="Back to top">
            <span className="feed-tabs-top-symbol" aria-hidden="true">↑</span>
          </a>
        </div>
      </nav>
      {forYouReadStatus && (
        <div className="feed-read-action">
          {unreadHref && (
            <a className="activity-side-link" href={unreadHref}>
              {hasDistinctLastUnread ? 'first unread' : 'unread'}
            </a>
          )}
          {hasDistinctLastUnread && <a className="activity-side-link" href={lastUnreadHref}>last unread</a>}
          <form className="feed-read-action-form" method="post"
            action={readAction || (toMe ? '/@/read-all' : '/my-feed/read-all')}
          >
            <button className="activity-side-link">mark all read</button>
          </form>
        </div>
      )}
    </>
  )
}

export function ProfileControls({ user, profile, following, followsViewer = false, blocked = false }: {
  user: User | null
  profile: ProfileRow
  following: boolean
  followsViewer?: boolean
  blocked?: boolean
}) {
  return (
    <div className="profile-action profile-handle-actions">
      {user && user.id !== profile.id && (
        <>
          {!blocked && (
            <form method="post" action={'/follow/' + profile.handle}>
              {!!followsViewer && <span className="follows-you">follows you</span>}
              <button className={`button${following ? ' button-muted' : ''}`}
                aria-label={`${following ? 'unfollow' : followsViewer ? 'follow back' : 'follow'} @${profile.handle}`}
              >
                {following ? 'unfollow' : followsViewer ? 'follow back' : 'follow'}
              </button>
            </form>
          )}
          <form method="post" action={'/block/' + profile.handle}>
            <button className={blocked ? 'button' : 'quiet danger'}
              aria-label={`${blocked ? 'unblock' : 'block'} @${profile.handle}`}
            >
              {blocked ? 'unblock' : 'block'}
            </button>
          </form>
        </>
      )}
      {!user && <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>}
      {isAdmin(user) && user?.id !== profile.id && (
        <a className="quiet danger" href={`/admin/users/${profile.id}`}>moderate</a>
      )}
    </div>
  )
}

export function ProfileHeader(
  { user, profile, following, followsViewer = false, blocked = false, editing = false, returnPath,
    controlsInTitle = true, bioReference, children }: {
      user: User | null
      profile: ProfileRow
      following: boolean
      followsViewer?: boolean
      blocked?: boolean
      editing?: boolean
      returnPath?: string
      controlsInTitle?: boolean
      bioReference?: BioReferenceData
      children?: React.ReactNode
    },
) {
  return (
    <section
      className={`page-header profile${user?.id === profile.id ? ' profile-owner' : ''}${
        editing ? ' profile-editing' : ''
      }${
        returnPath && !editing && user?.id !== profile.id
          ? ' profile-contextual'
          : ''
      }`}
    >
      {children || (
        <div className="profile-content">
          <div className={`profile-title-row${
            !editing && user?.id !== profile.id
              ? ' profile-title-row-actions'
              : ''
          }`}>
            <h1>
              <span className="identity-prefix">@</span>
              {profile.handle}
              {profile.mood && <span className="profile-mood">{profile.mood}</span>}
            </h1>
            {!editing && user?.id !== profile.id
              && (
                <ProfileControls user={user} profile={profile} following={following} followsViewer={followsViewer}
                  blocked={blocked} />
              )}
            {!editing && returnPath && user?.id !== profile.id
              && <a className="profile-edit-link profile-title-back-link" href={returnPath}>back</a>}
          </div>
          {profile.bio?.trim() && (
            <p className="profile-bio" dangerouslySetInnerHTML={{
              __html: linkify(displayBio(profile.bio), bioReference?.mentionBios || {}, [], undefined, undefined, '',
                bioReference?.hashtagCounts || {}, bioReference?.mentionNoteCounts || {}, {
                signedIn: !!user,
                currentHandle: user?.handle,
                formPrefix: `profile-${profile.id}-bio`,
                mentionFollowing: bioReference?.mentionFollowing,
                mentionFollowsViewer: bioReference?.mentionFollowsViewer,
                mentionProfileStats: bioReference?.mentionProfileStats,
                hashtagFollowing: bioReference?.hashtagFollowing,
                hashtagFollowerCounts: bioReference?.hashtagFollowerCounts,
                linkPreviews: bioReference?.linkPreviews,
              }),
            }} />
          )}
          <BioReferenceForms data={bioReference} prefix={`profile-${profile.id}-bio`} user={user} />
        </div>
      )}
      {!controlsInTitle && (
        <div className={`profile-action profile-back-action${
          user?.id === profile.id
            ? ' profile-owner-mobile-back'
            : ''
        }`}>
          {returnPath && !editing
            && <a className="profile-edit-link" href={returnPath}>back</a>}
          <ProfileControls user={user} profile={profile} following={following} followsViewer={followsViewer}
            blocked={blocked} />
        </div>
      )}
    </section>
  )
}

export function ProfileTabs(
  { profile, active, notes, replies = 0, followers, following, followingTags, showBlocked = false, blockedPeople = 0,
    blockedTags = 0, returnPath }: {
      profile: ProfileRow
      active: 'notes' | 'replies' | 'followers' | 'following' | 'blocked'
      notes: number
      replies?: number
      followers: number
      following: number
      followingTags: number
      showBlocked?: boolean
      blockedPeople?: number
      blockedTags?: number
      returnPath?: string
    },
) {
  const base = `/u/${profile.handle}`
  const tabHref = (tab?: string) => {
    const query = new URLSearchParams()
    if (tab) query.set('tab', tab)
    if (returnPath) query.set('from', returnPath)
    return `${base}${query.size ? `?${query}` : ''}`
  }
  return (
    <nav className="feed-tabs profile-tabs profile-page-tabs" aria-label={`@${profile.handle} profile`}>
      <div className="feed-tabs-scroll">
        <a className={active === 'notes' ? 'active' : ''} aria-current={active === 'notes' ? 'page' : undefined}
          href={tabHref()}
        >
          <TabHighlight active={active === 'notes'} />
          notes
        </a>
        <a className={active === 'replies' ? 'active' : ''} aria-current={active === 'replies' ? 'page' : undefined}
          href={tabHref('replies')}
        >
          <TabHighlight active={active === 'replies'} />
          replies
        </a>
        <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
          href={tabHref('following')}
        >
          <TabHighlight active={active === 'following'} />
          following
        </a>
        <a className={active === 'followers' ? 'active' : ''} aria-current={active === 'followers' ? 'page' : undefined}
          href={tabHref('followers')}
        >
          <TabHighlight active={active === 'followers'} />
          followers
        </a>
        {showBlocked && (
          <a className={active === 'blocked' ? 'active' : ''} aria-current={active === 'blocked' ? 'page' : undefined}
            href={tabHref('blocked')}
          >
            <TabHighlight active={active === 'blocked'} />
            blocked
          </a>
        )}
      </div>
    </nav>
  )
}

export function HighlightedText({ text, terms = [] }: { text: string; terms?: string[] }) {
  const matches = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!matches.length) return <>{text}</>
  const expression = new RegExp(`(${matches.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu')
  return (
    <>
      {text.split(expression).map((part, index) =>
        matches.some(term => part.toLocaleLowerCase() === term.toLocaleLowerCase())
          ? <mark key={index}>{part}</mark>
          : part
      )}
    </>
  )
}

export function TagChips(
  { user, tags, followingKey = 'following', highlightTerms = [], returnPath, showTagLinks = false }: {
    user: User | null
    tags: TagView[]
    followingKey?: 'following' | 'viewerFollowing'
    highlightTerms?: string[]
    returnPath: string
    showTagLinks?: boolean
  },
) {
  return (
    <div className="explore-tag-chips">
      {tags.map(tag => {
        const label = tag.displayName || tag.tag
        const tagHref = `/tag/${encodeURIComponent(tag.tag)}${
          showTagLinks ? `?from=${encodeURIComponent(returnPath)}` : ''
        }`
        const chip = user
          ? (
            <form method="post" action={`/tag-follow/${encodeURIComponent(tag.tag)}`}>
              <input type="hidden" name="from" value={returnPath} />
              <button className={`button explore-tag-chip${tag[followingKey] ? ' button-muted' : ''}`}
                aria-pressed={tag[followingKey]} title={`${tag[followingKey] ? 'Unfollow' : 'Follow'} #${tag.tag}`}
              >
                <span>
                  #<HighlightedText text={label} terms={highlightTerms} />
                </span>
              </button>
            </form>
          )
          : (
            <a className="button explore-tag-chip" href={tagHref}>
              <span>
                #<HighlightedText text={label} terms={highlightTerms} />
              </span>
            </a>
          )
        return showTagLinks
          ? (
            <div className="explore-tag-card" key={tag.tag}>
              {chip}
              <a className="explore-tag-link" href={tagHref} title={`View #${tag.tag}`}
                aria-label={`View #${tag.tag}`} />
            </div>
          )
          : <React.Fragment key={tag.tag}>{chip}</React.Fragment>
      })}
    </div>
  )
}

export function TagPeopleList(
  { user, tags, followingKey = 'following', highlightTerms = [], returnPath, showPopover = true }: {
    user: User | null
    tags: TagView[]
    followingKey?: 'following' | 'viewerFollowing'
    highlightTerms?: string[]
    returnPath?: (tag: TagView) => string
    showPopover?: boolean
  },
) {
  return (
    <div className="people tag-people">
      {tags.map(tag => (
        <article key={tag.tag} id={`tag-${tag.tag}`}>
          <div>
            <div>
              <TagReference tag={tag.tag} noteCount={tag.count} followerCount={tag.followerCount || 0}
                following={tag[followingKey]} user={user} showPopover={showPopover}
                navigationQuery={returnPath ? `?from=${encodeURIComponent(returnPath(tag))}` : ''} label={
                <>
                  #<HighlightedText text={tag.displayName || tag.tag} terms={highlightTerms} />
                </>
              } />
            </div>
            {user && (
              <form method="post" action={`/tag-follow/${encodeURIComponent(tag.tag)}`}>
                {returnPath && <input type="hidden" name="from" value={returnPath(tag)} />}
                <button className={`button${tag[followingKey] ? ' button-muted' : ''}`}>
                  {tag[followingKey] ? 'unfollow' : 'follow'}
                </button>
              </form>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

export function BlockedTagList({ user, tags }: { user: User; tags: TagView[] }) {
  return (
    <div className="people tag-people">
      {tags.map(tag => (
        <article key={tag.tag}>
          <div>
            <div>
              <TagReference tag={tag.tag} noteCount={tag.count} followerCount={tag.followerCount || 0} user={user}
                showFollowAction={false} showPopover={false} label={<>#{tag.displayName || tag.tag}</>} />
            </div>
            <form method="post" action={`/tag-block/${encodeURIComponent(tag.tag)}`}>
              <button className="button">unblock</button>
            </form>
          </div>
        </article>
      ))}
    </div>
  )
}

export function BlockedPeopleList({ user, people }: { user: User; people: PersonView[] }) {
  return (
    <div className="people">
      {people.map(person => (
        <article key={person.id}>
          <div>
            <div>
              <UserReference handle={person.handle} bio={person.bio} noteCount={person.posts}
                stats={person.profileStats} user={user} href={`/u/${person.handle}`} showFollowAction={false}
                showPopover={false} />
              <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>
            </div>
            <form method="post" action={`/block/${person.handle}`}>
              <button className="button">unblock</button>
            </form>
          </div>
        </article>
      ))}
    </div>
  )
}

export function ConnectionPeople(
  { user, people, className = '', highlightTerms = [], returnPath, showMood = false, showNoteCount = true,
    showPopover = true }: {
      user: User | null
      people: PersonView[]
      className?: string
      highlightTerms?: string[]
      returnPath?: (person: PersonView) => string
      showMood?: boolean
      showNoteCount?: boolean
      showPopover?: boolean
    },
) {
  return (
    <div className={`people connection-people ${className}`.trim()}>
      {people.map(person => (
        <article key={person.id} id={`person-${person.id}`}>
          <div>
            <div>
              <UserReference handle={person.handle} mood={showMood ? person.mood : undefined} bio={person.bio}
                noteCount={person.posts} stats={person.profileStats} following={person.viewerFollowing}
                followsViewer={person.followsViewer} user={user}
                href={`/u/${person.handle}${returnPath ? `?from=${encodeURIComponent(returnPath(person))}` : ''}`}
                showPopover={showPopover} referenceData={person.bioReference} label={
                <>
                  @<HighlightedText text={person.handle} terms={highlightTerms} />
                </>
              } />
              {showNoteCount && <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>}
              {person.bio?.trim() && (
                <p className="profile-bio" dangerouslySetInnerHTML={{
                  __html: linkify(displayBio(person.bio), person.bioReference?.mentionBios || {},
                    person.bio ? highlightTerms : [], undefined, undefined, '',
                    person.bioReference?.hashtagCounts || {}, person.bioReference?.mentionNoteCounts || {}, {
                    signedIn: !!user,
                    currentHandle: user?.handle,
                    formPrefix: `person-${person.id}-bio`,
                    linkPreviews: person.bioLinkPreviews,
                    mentionFollowing: person.bioReference?.mentionFollowing,
                    mentionFollowsViewer: person.bioReference?.mentionFollowsViewer,
                    mentionProfileStats: person.bioReference?.mentionProfileStats,
                    hashtagFollowing: person.bioReference?.hashtagFollowing,
                    hashtagFollowerCounts: person.bioReference?.hashtagFollowerCounts,
                  }),
                }} />
              )}
              <BioReferenceForms data={person.bioReference} prefix={`person-${person.id}-bio`} user={user} />
            </div>
            {user && user.id !== person.id && (
              <form method="post" action={`/follow/${person.handle}`}>
                {returnPath && <input type="hidden" name="from" value={returnPath(person)} />}
                {!!person.followsViewer && <span className="follows-you">follows you</span>}
                <button className={`button${person.viewerFollowing ? ' button-muted' : ''}`}>
                  {person.viewerFollowing ? 'unfollow' : person.followsViewer ? 'follow back' : 'follow'}
                </button>
              </form>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

export function ReportPanel({ post, showForm, reported, reason = '', error }: {
  post: PostView
  showForm: boolean
  reported: boolean
  reason?: string
  error?: string
}) {
  if (reported) {
    return (
      <div className="report-status" role="status">
        <span>Report received. Thank you.</span>
        <form method="post" action={`/block/${post.handle}`}>
          <button className="quiet danger" aria-label={`block @${post.handle}`}>block @{post.handle}</button>
        </form>
      </div>
    )
  }
  if (!showForm) return null
  return (
    <Panel className="report-panel">
      <form method="post" action={`/post/${post.id}/report`}>
        <FormMessage error={error} />
        <label className="form-label">
          reason
          <select className="form-control form-select" name="reason" required defaultValue={reason}>
            <option value="" disabled>choose a reason</option>
            {reason && !['harassment', 'spam', 'impersonation', 'bot', 'other'].includes(reason)
              && <option value={reason} hidden>{reason}</option>}
            <option value="harassment">harassment</option>
            <option value="spam">spam</option>
            <option value="impersonation">impersonation</option>
            <option value="bot">bot</option>
            <option value="other">other</option>
          </select>
        </label>
        <FormActions secondary={<a className="secondary-action cancel-action" href={`/post/${post.id}`}>cancel</a>}
          primary={<button className="button button-danger">submit report</button>} />
      </form>
    </Panel>
  )
}

export function GlobalFeedEmpty({ user }: { user: User | null }) {
  return (
    <div className="empty empty-actions">
      <p>No notes have been posted yet.</p>
      <ActionPair
        primary={user
          ? <a className="button" href={writeHref()}>write the first note →</a>
          : <a className="button" href="/enter" rel="nofollow">join and write →</a>}
        secondary={<a href="/explore">explore</a>}
      />
    </div>
  )
}
