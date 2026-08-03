import React from "react"
import { isAdmin } from "../admin"
import type { User } from "../db"
import type { PostView, ProfileRow } from "../types"

export const pageSize = 20
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
    <p className={error ? 'form-error' : 'form-success'} role={error ? 'alert' : 'status'}>
      {error || success}
    </p>
  )
}

export function Pagination({ page, totalPages, path }: { page: number; totalPages: number; path: string }) {
  if (totalPages <= 1) return null
  const separator = path.includes('?') ? '&' : '?'
  const windowStart = Math.max(1, Math.min(page - 1, totalPages - 2))
  const windowPages = Array.from({ length: Math.min(3, totalPages) }, (_, index) => windowStart + index)
  const pages = [...new Set([1, ...windowPages, totalPages])].sort((a, b) => a - b)
  return (
    <nav className="pagination" aria-label="Pagination">
      {page > 1
        ? <a className="pagination-edge" href={`${path}${separator}page=${page - 1}`}>← prev</a>
        : <span className="pagination-edge placeholder" />}
      <div className="pagination-pages">
        {pages.map((value, index) => (
          <React.Fragment key={value}>
            {index > 0 && value - pages[index - 1] === 2 && (
              <a href={`${path}${separator}page=${value - 1}`} aria-label={`Page ${value - 1}`}>{value - 1}</a>
            )}
            {index > 0 && value - pages[index - 1] > 2 && <span className="ellipsis" aria-hidden="true">…</span>}
            {value === page
              ? <span className="current" aria-current="page">{value}</span>
              : <a href={`${path}${separator}page=${value}`} aria-label={`Page ${value}`}>{value}</a>}
          </React.Fragment>
        ))}
      </div>
      {page < totalPages
        ? <a className="pagination-edge" href={`${path}${separator}page=${page + 1}`}>next →</a>
        : <span className="pagination-edge placeholder" />}
    </nav>
  )
}


export function FeedTabs({ active, user }: { active: 'following' | 'hot' | 'latest'; user: User | null }) {
  return (
    <nav className="feed-tabs" aria-label="Feed">
      {user && (
        <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
          href="/for-you"
        >
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
    </nav>
  )
}


export function ProfileHeader({ user, profile, following, blocked = false, editing = false, children }: {
  user: User | null
  profile: ProfileRow
  following: boolean
  blocked?: boolean
  editing?: boolean
  children?: React.ReactNode
}) {
  return (
    <section className={`page-header profile${user?.id === profile.id ? ' profile-owner' : ''}${editing ? ' profile-editing' : ''}`}>
      {children || (
        <div className="profile-content">
          <div className="profile-title-row">
            <h1><span className="identity-prefix">@</span>{profile.handle}</h1>
            {user?.id === profile.id && (
              <div className="profile-owner-actions">
                <a className="profile-edit-link" href={'/u/' + profile.handle + '?edit=1'}>edit</a>
                <form method="post" action="/logout">
                  <button className="profile-edit-link profile-logout">logout</button>
                </form>
              </div>
            )}
          </div>
          <p className="profile-bio">{profile.bio || 'No bio yet.'}</p>
        </div>
      )}
      <div className="profile-action">
        {isAdmin(user) && user?.id !== profile.id && (
          <a className="quiet danger" href={`/admin/users/${profile.id}`}>
            moderate
          </a>
        )}
        {user && user.id !== profile.id && (
          <>
            <form method="post" action={'/block/' + profile.handle}>
              <button className={blocked ? 'button' : 'quiet danger'}
                aria-label={`${blocked ? 'unblock' : 'block'} @${profile.handle}`}
              >
                {blocked ? 'unblock' : 'block'}
              </button>
            </form>
            {!blocked && (
              <form method="post" action={'/follow/' + profile.handle}>
                <button className={`button${following ? ' unfollow-button' : ''}`}
                  aria-label={`${following ? 'unfollow' : 'follow'} @${profile.handle}`}
                >
                  {following ? 'unfollow' : 'follow'}
                </button>
              </form>
            )}
          </>
        )}
        {!user && <a className="button" href="/login">log in to follow</a>}
      </div>
    </section>
  )
}

export function ProfileTabs({ profile, active, notes, followers, following, followingTags }: {
  profile: ProfileRow
  active: 'notes' | 'followers' | 'following'
  notes: number
  followers: number
  following: number
  followingTags: number
}) {
  const base = `/u/${profile.handle}`
  return (
    <nav className="feed-tabs profile-tabs" aria-label={`@${profile.handle} profile`}>
      <a className={active === 'notes' ? 'active' : ''} aria-current={active === 'notes' ? 'page' : undefined}
        href={base}
      >
        {notes} {notes === 1 ? 'note' : 'notes'}
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
    </nav>
  )
}


export function TagPeopleList({ user, tags, followingKey = 'following' }: {
  user: User | null
  tags: any[]
  followingKey?: 'following' | 'viewerFollowing'
}) {
  return (
    <div className="people tag-people">
      {tags.map(tag => (
        <article key={tag.tag}>
          <div>
            <div>
              <a href={`/tag/${tag.tag}`}>#{tag.tag}</a>
              <small>{tag.count} {tag.count === 1 ? 'note' : 'notes'}</small>
            </div>
            {user && (
              <form method="post" action={`/tag-follow/${tag.tag}`}>
                <button className={`button${tag[followingKey] ? ' unfollow-button' : ''}`}>
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

export function ConnectionPeople({ user, people, className = '' }: {
  user: User | null
  people: any[]
  className?: string
}) {
  return (
    <div className={`people ${className}`.trim()}>
      {people.map(person => (
        <article key={person.id}>
          <div>
            <div>
              <a href={`/u/${person.handle}`}>@{person.handle}</a>
              <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>
            </div>
            {user && user.id !== person.id && (
              <form method="post" action={`/follow/${person.handle}`}>
                <button className={`button${person.viewerFollowing ? ' unfollow-button' : ''}`}>
                  {person.viewerFollowing ? 'unfollow' : 'follow'}
                </button>
              </form>
            )}
          </div>
          <p className="profile-bio">{person.bio || 'No bio yet.'}</p>
        </article>
      ))}
    </div>
  )
}


export function ReportPanel({ post, showForm, reported }: { post: PostView; showForm: boolean; reported: boolean }) {
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
        <label>
          reason
          <select name="reason" required defaultValue="">
            <option value="" disabled>choose a reason</option>
            <option value="harassment">harassment</option>
            <option value="spam">spam</option>
            <option value="impersonation">impersonation</option>
            <option value="other">other</option>
          </select>
        </label>
        <div className="form-actions">
          <a className="quiet" href={`/post/${post.id}`}>cancel</a>
          <button className="button delete-button">submit report</button>
        </div>
      </form>
    </div>
  )
}

export function GlobalFeedEmpty({ user }: { user: User | null }) {
  return (
    <div className="empty empty-actions">
      <p>No notes have been posted yet.</p>
      <div>
        {user
          ? <a className="button" href="/compose">write the first note →</a>
          : <a className="button" href="/signup">join and write →</a>}
        <a href="/explore">explore</a>
      </div>
    </div>
  )
}
