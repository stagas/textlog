import type { BioReferenceData, PersonView, PostView, ProfileRow, TagView } from '../types'

import React from 'react'
import { isAdmin } from '../admin'
import { markdownPlainText } from '../markdown'
import { searchTerms } from '../search'
import type { User } from '../types'
import { displayBio, linkify } from '../utils'
import { enterHref } from './auth-links'
import { Panel } from './panel'
import { BioReferenceForms, TagReference, UserReference } from './post'

const postTitleLength = 60

export function postTitle(body: string) {
  const text = markdownPlainText(body)
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

function PostingFormattingHelp() {
  const tabId = React.useId()
  return (
    <section className="posting-help-section posting-help-syntax">
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-formatting`}
        defaultChecked />
      <input className="posting-help-tab-input" type="radio" name={`${tabId}-tab`} id={`${tabId}-modifiers`} />
      <nav className="posting-help-tabs" aria-label="Writing help">
        <label htmlFor={`${tabId}-formatting`}>formatting</label>
        <label htmlFor={`${tabId}-modifiers`}>modifiers</label>
      </nav>
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
                  <b>`</b>code<b>`</b>
                </code>
              </dd>
              <dt>Inline code</dt>
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
                  Which one? <b>#poll</b><br />
                  First option<br />
                  Second option
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Polls</span>
                <small>Use 2–8 unique options.</small></dt>
            </div>
            <div>
              <dd>
                <code>
                  Which one? <b>#quiz</b><br />
                  Wrong answer<br />
                  <b>&gt; </b>Correct answer<br />
                  <br />
                  Explanation revealed after answering
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Quizzes</span>
                <small>Mark exactly one of 2–8 unique answers with &gt;. Text after a blank line is revealed after answering.</small></dt>
            </div>
            <div>
              <dd>
                <code>
                  Visible text <b>#spoiler</b><br />
                  Hidden text
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Spoilers</span>
                <small>Text after #spoiler is hidden until revealed.</small></dt>
            </div>
            <div>
              <dd>
                <code>
                  Today <b>#todo</b><br />
                  <b>[ ]</b> First task<br />
                  <b>[x]</b> Finished task
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Todos</span>
                <small>Only [ ] and [x] lines become items. Click your items to toggle them.</small></dt>
            </div>
            <div>
              <dd>
                <code>
                  Keep this visible <b>#pin</b>
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Pinned notes</span>
                <small>Your latest #pin is shown first on your profile, independently for notes and replies.</small></dt>
            </div>
            <div>
              <dd>
                <code>
                  No more replies <b>#lock</b>
                </code>
              </dd>
              <dt><span className="posting-help-modifier-heading">Locked conversations</span>
                <small>Prevents new replies to this note and every reply beneath it.</small></dt>
            </div>
      </dl>
    </section>
  )
}

export function PostingHelp({ maxLength = 500, maxLines = 10, search, oneLine = false }: {
  maxLength?: number
  maxLines?: number
  search?: PostingSuggestionSearch | null
  oneLine?: boolean
}) {
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
          <section className="posting-help-section">
            <div className="posting-help-searches">
              <PostingSuggestionSearchField kind="hashtags" search={search} />
              <PostingSuggestionSearchField kind="mentions" search={search} />
            </div>
          </section>
          <PostingFormattingHelp />
          <section className="posting-help-section">
            <div className="posting-help-emoji-panel" aria-label="Emoji to copy and paste">
              {'😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 ☠️ 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 👏 🙌 🫶 👐 🤲 🙏 ✍️ 💪 👀 👁️ 🧠 🫀 🫁 🌱 🌿 ☘️ 🍀 🌸 🌺 🌻 🌞 🌙 ⭐ ✨ ⚡ 🔥 🌈 ☀️ ☁️ ❄️ ☕ 🍕 🍎 🎉 🎊 🎈 🎁 🎵 🎶 🎨 📚 💡 ✅ ❌ ⚠️ 🚀 🌍 💻 📱 🔒 🔑'
                .split(' ').map((emoji, index) => (
                  <span key={`${emoji}-${index}`} title="Select and copy">{emoji}</span>
                ))}
            </div>
          </section>
        </div>
    </div>
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
          <span key={result}>
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

export function VerificationRequired() {
  return (
    <Panel className="status-message status-error" role="alert">
      Confirm your email address before posting. <a href="/account/security">Verify your email</a>
    </Panel>
  )
}

export function Pagination(
  { page, totalPages, path, pageParam = 'page', label = 'Pagination', compact = false, top = false, anchor }: {
    page: number
    totalPages: number
    path: string
    pageParam?: string
    label?: string
    compact?: boolean
    top?: boolean
    anchor?: string
  },
) {
  if (totalPages <= 1) return null
  const separator = path.includes('?') ? '&' : '?'
  const [formPath, formQuery = ''] = path.split('?', 2)
  const formParameters = [...new URLSearchParams(formQuery)].filter(([name]) => name !== pageParam)
  const fragment = anchor ? `#${anchor}` : ''
  const windowStart = Math.max(1, Math.min(page - 1, totalPages - 2))
  const windowPages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => windowStart + index)
  const pages = [...new Set([1, ...windowPages, totalPages])].sort((a, b) => a - b)
  return (
    <nav className={`pagination${compact ? ' pagination-compact' : ''}${top ? ' pagination-top' : ''}`}
      aria-label={label}
    >
      {page > 1
        ? (
          <a className="pagination-edge" href={`${path}${separator}${pageParam}=${page - 1}${fragment}`}
            aria-label="Previous page"
          >
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
                  aria-current="page">
                  {formParameters.map(([name, parameterValue]) => (
                    <input key={`${name}:${parameterValue}`} type="hidden" name={name} value={parameterValue} />
                  ))}
                  <input className="current" aria-label={`Current page, ${page} of ${totalPages}`} type="number"
                    name={pageParam} min={1} max={totalPages} defaultValue={value} required autoComplete="off"
                    inputMode="numeric" enterKeyHint="go" />
                </form>
              )
              : <a href={`${path}${separator}${pageParam}=${value}${fragment}`} aria-label={`Page ${value}`}>{value}</a>}
          </React.Fragment>
        ))}
      </div>
      {page < totalPages
        ? (
          <a className="pagination-edge" href={`${path}${separator}${pageParam}=${page + 1}${fragment}`}
            aria-label="Next page">
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

export function FeedTabs(
  { active, user, forYouReadStatus, activityReadStatus, toMe = false, toMeCount = 0, forYouCount = 0, unreadHref,
    lastUnreadHref, forYouUnread = false, toMeUnread = false, latestCount = 0, viewMode = 'tree', viewHref,
    readAction }: {
      active: 'following' | 'activity' | 'hot' | 'latest'
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
      viewMode?: 'tree' | 'flat'
      viewHref?: string
      readAction?: string
    },
) {
  forYouUnread = forYouUnread || toMeUnread
  const hasDistinctLastUnread = !!lastUnreadHref && lastUnreadHref !== unreadHref
  const viewQuery = viewMode === 'flat' ? '?view=flat' : ''
  return (
    <>
      <nav className="feed-tabs" id="feed-tabs" aria-label="Feed">
        {user && (
          <a className={active === 'following' ? 'active' : ''}
            aria-current={active === 'following' ? 'page' : undefined} href={`/for-you${viewQuery}`}
          >
            for you
            {forYouCount > 0 && <span className="to-me-count">{forYouCount}</span>}
          </a>
        )}
        <a className={active === 'hot' ? 'active' : ''} aria-current={active === 'hot' ? 'page' : undefined}
          href={user ? `/hot${viewQuery}` : `/hot${viewQuery}#feed-tabs`}
        >
          hot
        </a>
        <a className={active === 'latest' ? 'active' : ''} aria-current={active === 'latest' ? 'page' : undefined}
          href={user ? `/latest${viewQuery}` : `/latest${viewQuery}#feed-tabs`}
        >
          latest
          {latestCount > 0 && <span className="to-me-count">{latestCount}</span>}
        </a>
        {(viewHref || active === 'following' || toMeCount > 0 || activityReadStatus !== undefined) && (
          <span className="feed-tabs-read-status">
            {(viewHref || active === 'following' || toMeCount > 0) && (
              <span className="feed-tabs-view-filters">
                {(active === 'following' || toMeCount > 0) && (
                  <a className={`activity-side-link${toMe ? '' : ' has-to-me-count'}`}
                    href={`${toMe ? '/for-you' : '/to-me'}${viewQuery}`}>
                    {toMe ? 'all' : (
                      <>
                        <span className="to-me-label">to me</span>
                        {toMeCount > 0 && <span className="to-me-count">{toMeCount}</span>}
                      </>
                    )}
                  </a>
                )}
                {viewHref && (
                  <a className="activity-side-link" href={viewHref}>{viewMode === 'flat' ? 'tree' : 'flat'}</a>
                )}
              </span>
            )}
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
      </nav>
      {forYouReadStatus && (
        <div className="feed-read-action">
          {unreadHref && <span className="activity-side-status">jump to</span>}
          {unreadHref && <a className="activity-side-link" href={unreadHref}>
            {hasDistinctLastUnread ? 'first unread' : 'unread'}
          </a>}
          {hasDistinctLastUnread && <span className="feed-tabs-action-separator" aria-hidden="true">·</span>}
          {hasDistinctLastUnread && <a className="activity-side-link" href={lastUnreadHref}>last unread</a>}
          {unreadHref && <span className="feed-tabs-action-separator feed-read-action-separator" aria-hidden="true">·</span>}
          <form className="feed-read-action-form" method="post"
            action={readAction || (toMe ? '/to-me/read-all' : '/for-you/read-all')}>
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
            </h1>
            {!editing && user?.id !== profile.id
              && (
                <ProfileControls user={user} profile={profile} following={following} followsViewer={followsViewer}
                  blocked={blocked} />
              )}
            {!editing && returnPath && user?.id !== profile.id
              && <a className="profile-edit-link profile-title-back-link" href={returnPath}>back</a>}
          </div>
          {profile.bio?.trim() && <p className="profile-bio" dangerouslySetInnerHTML={{
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
          }} />}
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
    <nav className="feed-tabs profile-tabs" aria-label={`@${profile.handle} profile`}>
      <a className={active === 'notes' ? 'active' : ''} aria-current={active === 'notes' ? 'page' : undefined}
        href={tabHref()}
      >
        notes
      </a>
      <a className={active === 'replies' ? 'active' : ''} aria-current={active === 'replies' ? 'page' : undefined}
        href={tabHref('replies')}
      >
        replies
      </a>
      <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
        href={tabHref('following')}
      >
        following
      </a>
      <a className={active === 'followers' ? 'active' : ''} aria-current={active === 'followers' ? 'page' : undefined}
        href={tabHref('followers')}
      >
        followers
      </a>
      {showBlocked && (
        <a className={active === 'blocked' ? 'active' : ''} aria-current={active === 'blocked' ? 'page' : undefined}
          href={tabHref('blocked')}
        >
          blocked
        </a>
      )}
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

export function TagChips({ user, tags, followingKey = 'following', highlightTerms = [], returnPath }: {
  user: User | null
  tags: TagView[]
  followingKey?: 'following' | 'viewerFollowing'
  highlightTerms?: string[]
  returnPath: string
}) {
  return (
    <div className="explore-tag-chips">
      {tags.map(tag => user
        ? (
          <form key={tag.tag} method="post" action={`/tag-follow/${encodeURIComponent(tag.tag)}`}>
            <input type="hidden" name="from" value={returnPath} />
            <button className={`button explore-tag-chip${tag[followingKey] ? ' button-muted' : ''}`}
              aria-pressed={tag[followingKey]} title={`${tag[followingKey] ? 'Unfollow' : 'Follow'} #${tag.tag}`}>
              <span>#<HighlightedText text={tag.tag} terms={highlightTerms} /></span>
            </button>
          </form>
        )
        : <a key={tag.tag} className="button explore-tag-chip" href={`/tag/${encodeURIComponent(tag.tag)}`}>
          <span>#<HighlightedText text={tag.tag} terms={highlightTerms} /></span>
        </a>)}
    </div>
  )
}

export function TagPeopleList({ user, tags, followingKey = 'following', highlightTerms = [], returnPath,
  showPopover = true }: {
  user: User | null
  tags: TagView[]
  followingKey?: 'following' | 'viewerFollowing'
  highlightTerms?: string[]
  returnPath?: (tag: TagView) => string
  showPopover?: boolean
}) {
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
                  #<HighlightedText text={tag.tag} terms={highlightTerms} />
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
                showFollowAction={false} showPopover={false} />
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

export function ConnectionPeople({ user, people, className = '', highlightTerms = [], returnPath, showNoteCount = true,
  showPopover = true }: {
  user: User | null
  people: PersonView[]
  className?: string
  highlightTerms?: string[]
  returnPath?: (person: PersonView) => string
  showNoteCount?: boolean
  showPopover?: boolean
}) {
  return (
    <div className={`people connection-people ${className}`.trim()}>
      {people.map(person => (
        <article key={person.id} id={`person-${person.id}`}>
          <div>
            <div>
              <UserReference handle={person.handle} bio={person.bio} noteCount={person.posts}
                stats={person.profileStats} following={person.viewerFollowing} followsViewer={person.followsViewer}
                user={user} href={`/u/${person.handle}${
                  returnPath ? `?from=${encodeURIComponent(returnPath(person))}` : ''
                }`} showPopover={showPopover} referenceData={person.bioReference} label={
                <>
                  @<HighlightedText text={person.handle} terms={highlightTerms} />
                </>
              } />
              {showNoteCount && <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>}
              {person.bio?.trim() && <p className="profile-bio" dangerouslySetInnerHTML={{
                __html: linkify(displayBio(person.bio), person.bioReference?.mentionBios || {},
                  person.bio ? highlightTerms : [], undefined, undefined, '', person.bioReference?.hashtagCounts || {},
                  person.bioReference?.mentionNoteCounts || {}, {
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
              }} />}
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
          ? <a className="button" href="/write">write the first note →</a>
          : <a className="button" href="/enter" rel="nofollow">join and write →</a>}
        secondary={<a href="/explore">explore</a>}
      />
    </div>
  )
}
