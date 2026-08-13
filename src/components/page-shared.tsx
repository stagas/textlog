import type { PersonView, PostView, ProfileRow, TagView } from '../types'

import React from 'react'
import { isAdmin } from '../admin'
import type { User } from '../db'
import { hasUnreadForYou } from '../for-you-state'

const postTitleLength = 60

export function postTitle(body: string) {
  const text = body.replace(/\s+/g, ' ').trim()
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

export function PostingHelp({ maxLength = 280, maxLines = 10 }: { maxLength?: number; maxLines?: number }) {
  return (
    <div className="posting-help">
      <span>{maxLength} chars / {maxLines} lines max · use #hashtags, @mentions</span>
      <details className="posting-help-more">
        <summary>and more</summary>
        <div className="posting-help-popover">
          <strong>Formatting</strong>
          <dl>
            <div>
              <dt>Regular links</dt>
              <dd>
                <code>
                  <span className="posting-help-link">example.com</span> or
                  <br />
                  <span className="posting-help-link">https://example.com</span>
                </code>
              </dd>
            </div>
            <div>
              <dt>Markdown links</dt>
              <dd>
                <code>
                  <b>[</b>title<b>](</b>example.com<b>)</b> or
                  <br />
                  <b>[</b>title<b>](</b>https://example.com<b>)</b>
                </code>
              </dd>
            </div>
            <div>
              <dt>Inline code</dt>
              <dd>
                <code>
                  <b>`</b>code<b>`</b>
                </code>
              </dd>
            </div>
            <div>
              <dt>Code fences</dt>
              <dd>
                <code>
                  <b>```</b>…<b>```</b>
                </code>
              </dd>
            </div>
            <div>
              <dt>Inline LaTeX</dt>
              <dd>
                <code>
                  <b>$</b>inline<b>$</b>
                </code>
              </dd>
            </div>
            <div>
              <dt>Block LaTeX</dt>
              <dd>
                <code>
                  <b>$$</b>block<b>$$</b>
                </code>
              </dd>
            </div>
          </dl>
        </div>
      </details>
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
    <div className="panel status-message status-error" role="alert">
      Confirm your email address before posting. <a href="/account/security">Verify your email</a>
    </div>
  )
}

export function Pagination(
  { page, totalPages, path, pageParam = 'page', label = 'Pagination', compact = false, top = false }: {
    page: number
    totalPages: number
    path: string
    pageParam?: string
    label?: string
    compact?: boolean
    top?: boolean
  },
) {
  if (totalPages <= 1) return null
  const separator = path.includes('?') ? '&' : '?'
  const [formPath, formQuery = ''] = path.split('?', 2)
  const formParameters = [...new URLSearchParams(formQuery)].filter(([name]) => name !== pageParam)
  const windowStart = Math.max(1, Math.min(page - 1, totalPages - 2))
  const windowPages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => windowStart + index)
  const pages = [...new Set([1, ...windowPages, totalPages])].sort((a, b) => a - b)
  return (
    <nav className={`pagination${compact ? ' pagination-compact' : ''}${top ? ' pagination-top' : ''}`}
      aria-label={label}
    >
      {page > 1
        ? (
          <a className="pagination-edge" href={`${path}${separator}${pageParam}=${page - 1}`}
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
                <form className="pagination-current-form" method="get" action={formPath} aria-current="page">
                  {formParameters.map(([name, parameterValue]) => (
                    <input key={`${name}:${parameterValue}`} type="hidden" name={name} value={parameterValue} />
                  ))}
                  <input className="current" aria-label={`Current page, ${page} of ${totalPages}`}
                    type="number" name={pageParam} min={1} max={totalPages} defaultValue={value} required />
                </form>
              )
              : <a href={`${path}${separator}${pageParam}=${value}`} aria-label={`Page ${value}`}>{value}</a>}
          </React.Fragment>
        ))}
      </div>
      {page < totalPages
        ? (
          <a className="pagination-edge" href={`${path}${separator}${pageParam}=${page + 1}`} aria-label="Next page">
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

export function FeedTabs({ active, user, forYouReadStatus, activityReadStatus, toMe = false }: {
  active: 'following' | 'activity' | 'hot' | 'latest'
  user: User | null
  forYouReadStatus?: boolean
  activityReadStatus?: boolean
  toMe?: boolean
}) {
  const forYouUnread = user ? hasUnreadForYou(user.id) : false
  return (
    <nav className="feed-tabs" aria-label="Feed">
      {user && (
        <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
          href="/for-you"
        >
          {forYouUnread && <span className="unread-dot" aria-hidden="true" />}
          {forYouUnread && <span className="visually-hidden">unread</span>}
          for you
        </a>
      )}
      <a className={active === 'hot' ? 'active' : ''} aria-current={active === 'hot' ? 'page' : undefined} href="/hot">
        hot
      </a>
      <a className={active === 'latest' ? 'active' : ''} aria-current={active === 'latest' ? 'page' : undefined}
        href="/latest"
      >
        latest
      </a>
      {(active === 'following' || forYouReadStatus !== undefined || activityReadStatus !== undefined) && (
        <span className="feed-tabs-read-status">
          {active === 'following' && (
            <>
              <a className="activity-side-link" href={toMe ? '/for-you' : '/to-me'}>
                {toMe ? 'all' : 'to me'}
              </a>
              {(forYouReadStatus !== undefined || activityReadStatus !== undefined)
                && <span className="feed-tabs-action-separator" aria-hidden="true">·</span>}
            </>
          )}
          {(forYouReadStatus !== undefined || activityReadStatus !== undefined)
            && ((forYouReadStatus ?? activityReadStatus)
              ? (
                <form method="post" action={activityReadStatus !== undefined
                  ? '/activity/read-all'
                  : toMe
                  ? '/to-me/read-all'
                  : '/for-you/read-all'}
                >
                  <button className="activity-side-link">mark all as read</button>
                </form>
              )
              : <span className="activity-side-status">you've seen it all</span>)}
        </span>
      )}
    </nav>
  )
}

export function ProfileControls({ user, profile, following, blocked = false }: {
  user: User | null
  profile: ProfileRow
  following: boolean
  blocked?: boolean
}) {
  return (
    <div className="profile-action profile-handle-actions">
      {user && user.id !== profile.id && (
        <>
          {!blocked && (
            <form method="post" action={'/follow/' + profile.handle}>
              <button className={`button${following ? ' button-muted' : ''}`}
                aria-label={`${following ? 'unfollow' : 'follow'} @${profile.handle}`}>
                {following ? 'unfollow' : 'follow'}
              </button>
            </form>
          )}
          <form method="post" action={'/block/' + profile.handle}>
            <button className={blocked ? 'button' : 'quiet danger'}
              aria-label={`${blocked ? 'unblock' : 'block'} @${profile.handle}`}>
              {blocked ? 'unblock' : 'block'}
            </button>
          </form>
        </>
      )}
      {!user && <a className="button" href="/enter" rel="nofollow">enter to follow</a>}
      {isAdmin(user) && user?.id !== profile.id && (
        <a className="quiet danger" href={`/admin/users/${profile.id}`}>moderate</a>
      )}
    </div>
  )
}

export function ProfileHeader(
  { user, profile, following, blocked = false, editing = false, returnPath, controlsInTitle = false, children }: {
  user: User | null
  profile: ProfileRow
  following: boolean
  blocked?: boolean
  editing?: boolean
  returnPath?: string
  controlsInTitle?: boolean
  children?: React.ReactNode
}) {
  return (
    <section
      className={`page-header profile${user?.id === profile.id ? ' profile-owner' : ''}${
        editing ? ' profile-editing' : ''}${returnPath && !editing && user?.id !== profile.id
          ? ' profile-contextual'
          : ''
      }`}
    >
      {children || (
        <div className="profile-content">
          <div className="profile-title-row">
            <h1>
              <span className="identity-prefix">@</span>
              {profile.handle}
            </h1>
            {user?.id === profile.id && (
              <div className="profile-owner-actions">
                <a className="profile-edit-link" href="/account/edit">account</a>
                <form method="post" action="/logout">
                  <button className="profile-edit-link profile-logout">logout</button>
                </form>
              </div>
            )}
          </div>
          <p className="profile-bio">{profile.bio || 'No bio yet.'}</p>
        </div>
      )}
      <div className="profile-action profile-back-action">
        {returnPath && !editing && user?.id !== profile.id
          && <a className="profile-edit-link" href={returnPath}>back</a>}
        {!controlsInTitle && <ProfileControls user={user} profile={profile} following={following} blocked={blocked} />}
      </div>
    </section>
  )
}

export function ProfileTabs(
  { profile, active, notes, replies = 0, followers, following, followingTags, showBlocked = false, blockedPeople = 0,
    blockedTags = 0 }: {
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
    },
) {
  const base = `/u/${profile.handle}`
  return (
    <nav className="feed-tabs profile-tabs" aria-label={`@${profile.handle} profile`}>
      <a className={active === 'notes' ? 'active' : ''} aria-current={active === 'notes' ? 'page' : undefined}
        href={base}
      >
        {notes} {notes === 1 ? 'note' : 'notes'}
      </a>
      <a className={active === 'replies' ? 'active' : ''} aria-current={active === 'replies' ? 'page' : undefined}
        href={`${base}?tab=replies`}
      >
        {replies} {replies === 1 ? 'reply' : 'replies'}
      </a>
      <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
        href={`${base}?tab=following`}
      >
        {followingTags} {followingTags === 1 ? 'tag' : 'tags'}, {following} {following === 1 ? 'user' : 'users'}{' '}
        following
      </a>
      <a className={active === 'followers' ? 'active' : ''} aria-current={active === 'followers' ? 'page' : undefined}
        href={`${base}?tab=followers`}
      >
        {followers} {followers === 1 ? 'follower' : 'followers'}
      </a>
      {showBlocked && (
        <a className={active === 'blocked' ? 'active' : ''} aria-current={active === 'blocked' ? 'page' : undefined}
          href={`${base}?tab=blocked`}
        >
          {blockedTags} {blockedTags === 1 ? 'tag' : 'tags'}, {blockedPeople} {blockedPeople === 1 ? 'user' : 'users'}
          {' '}
          blocked
        </a>
      )}
    </nav>
  )
}

function HighlightedText({ text, terms = [] }: { text: string; terms?: string[] }) {
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

export function TagPeopleList({ user, tags, followingKey = 'following', highlightTerms = [] }: {
  user: User | null
  tags: TagView[]
  followingKey?: 'following' | 'viewerFollowing'
  highlightTerms?: string[]
}) {
  return (
    <div className="people tag-people">
      {tags.map(tag => (
        <article key={tag.tag}>
          <div>
            <div>
              <a href={`/tag/${encodeURIComponent(tag.tag)}`}>
                #<HighlightedText text={tag.tag} terms={highlightTerms} />
              </a>
              <small>{tag.count} {tag.count === 1 ? 'note' : 'notes'}</small>
            </div>
            {user && (
              <form method="post" action={`/tag-follow/${encodeURIComponent(tag.tag)}`}>
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

export function BlockedTagList({ tags }: { tags: TagView[] }) {
  return (
    <div className="people tag-people">
      {tags.map(tag => (
        <article key={tag.tag}>
          <div>
            <div>
              <a href={`/tag/${encodeURIComponent(tag.tag)}`}>#{tag.tag}</a>
              <small>{tag.count} {tag.count === 1 ? 'note' : 'notes'}</small>
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

export function BlockedPeopleList({ people }: { people: PersonView[] }) {
  return (
    <div className="people">
      {people.map(person => (
        <article key={person.id}>
          <div>
            <div>
              <a href={`/u/${person.handle}`}>@{person.handle}</a>
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

export function ConnectionPeople({ user, people, className = '', highlightTerms = [] }: {
  user: User | null
  people: PersonView[]
  className?: string
  highlightTerms?: string[]
}) {
  return (
    <div className={`people ${className}`.trim()}>
      {people.map(person => (
        <article key={person.id}>
          <div>
            <div>
              <a href={`/u/${person.handle}`}>
                @<HighlightedText text={person.handle} terms={highlightTerms} />
              </a>
              <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>
            </div>
            {user && user.id !== person.id && (
              <form method="post" action={`/follow/${person.handle}`}>
                <button className={`button${person.viewerFollowing ? ' button-muted' : ''}`}>
                  {person.viewerFollowing ? 'unfollow' : 'follow'}
                </button>
              </form>
            )}
          </div>
          <p className="profile-bio">
            <HighlightedText text={person.bio || 'No bio yet.'} terms={person.bio ? highlightTerms : []} />
          </p>
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
    <div className="panel report-panel">
      <form method="post" action={`/post/${post.id}/report`}>
        <FormMessage error={error} />
        <label className="form-label">
          reason
          <select className="form-control form-select" name="reason" required defaultValue={reason}>
            <option value="" disabled>choose a reason</option>
            {reason && !['harassment', 'spam', 'impersonation', 'other'].includes(reason)
              && <option value={reason} hidden>{reason}</option>}
            <option value="harassment">harassment</option>
            <option value="spam">spam</option>
            <option value="impersonation">impersonation</option>
            <option value="other">other</option>
          </select>
        </label>
        <FormActions secondary={<a className="secondary-action" href={`/post/${post.id}`}>cancel</a>}
          primary={<button className="button button-danger">submit report</button>} />
      </form>
    </div>
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
