import React from 'react'
import { isAdmin, isAdminEmail } from '../admin'
import { db, type User } from '../db'
import { getHotPosts } from '../hot'
import { enrichPosts } from '../posts'
import type { PersonView, PostRow, PostView, ProfileRow, SessionView } from '../types'
import type { AdminActionView, AdminReportView, DashboardStats } from '../types'
import { fmtFull } from '../utils'
import { Layout } from './layout'
import { Post, ThreadReplies } from './post'

const pageSize = 20
const postTitleLength = 60
const activityPostWhere = `p.deleted_at IS NULL AND
  (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id != ?)) AND
  NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`

export function activityTotal(userId: number) {
  const postTotal = (db.query(
    `SELECT count(DISTINCT p.id) count FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE ${activityPostWhere}`,
  ).get(userId, userId, userId, userId, userId) as { count: number }).count
  const followTotal = (db.query(
    `SELECT count(*) count FROM follows f WHERE following_id=? AND created_at IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
        OR (b.blocker_id=f.follower_id AND b.blocked_id=?))`,
  ).get(userId, userId, userId) as { count: number }).count
  return postTotal + followTotal
}

export function postTitle(body: string) {
  const text = body.replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  return characters.length > postTitleLength
    ? `${characters.slice(0, postTitleLength - 1).join('').trimEnd()}…`
    : text
}

function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null
  return (
    <p className={error ? 'form-error' : 'form-success'} role={error ? 'alert' : 'status'}>
      {error || success}
    </p>
  )
}

function Pagination({ page, totalPages, path }: { page: number; totalPages: number; path: string }) {
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

export function AdminDashboard({ user, stats, reports, actions, status, page, total, suspended = [] }: {
  user: User
  stats: DashboardStats
  reports: AdminReportView[]
  actions: AdminActionView[]
  status: 'open' | 'resolved' | 'dismissed'
  page: number
  total: number
  suspended?: ProfileRow[]
}) {
  const labels: [keyof DashboardStats, string][] = [
    ['users', 'users'],
    ['suspendedUsers', 'suspended'],
    ['activePosts', 'active posts'],
    ['replies', 'replies'],
    ['openReports', 'open reports'],
    ['users24h', 'new users · 24h'],
    ['users7d', 'new users · 7d'],
    ['posts24h', 'new posts · 24h'],
    ['posts7d', 'new posts · 7d'],
  ]
  return (
    <Layout user={user} title="admin">
      <section className="page-header admin-header">
        <div>
          <p className="eyebrow">operations</p>
          <h1>admin dashboard</h1>
        </div>
      </section>
      <section className="admin-stats" aria-label="Application statistics">
        {labels.map(([key, label]) => (
          <article key={key}>
            <strong>{stats[key]}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
      <nav className="feed-tabs admin-tabs" aria-label="Report status">
        {(['open', 'resolved', 'dismissed'] as const).map(value => (
          <a key={value} className={status === value ? 'active' : ''}
            aria-current={status === value ? 'page' : undefined} href={`/admin?status=${value}`}
          >
            {value}
          </a>
        ))}
      </nav>
      <section className="admin-section">
        <h2>
          {status} reports <span>{total}</span>
        </h2>
        {reports.length
          ? (
            <div className="report-list">
              {reports.map(report => (
                <article className="admin-report" key={report.id}>
                  <div className="admin-report-meta">
                    <span>
                      #{report.id} · {report.reason} ·{' '}
                      <time dateTime={report.created_at}>{fmtFull(report.created_at)}</time>
                    </span>
                    <span>
                      reported by <a href={`/u/${report.reporter_handle}`}>@{report.reporter_handle}</a>
                    </span>
                  </div>
                  <p>{report.post_deleted_at ? '(deleted)' : report.post_body}</p>
                  <div className="admin-report-targets">
                    <a href={`/post/${report.post_id}`}>post #{report.post_id}</a>
                    <a href={`/u/${report.author_handle}`}>@{report.author_handle}</a>
                    {report.resolver_handle && <span>handled by @{report.resolver_handle}</span>}
                  </div>
                  {report.status === 'open' && (
                    <div className="admin-inline-actions">
                      <form method="post" action={`/admin/reports/${report.id}/resolve`}>
                        <input name="note" maxLength={500} aria-label="Optional resolution note"
                          placeholder="optional note" />
                        <button className="quiet">resolve</button>
                      </form>
                      <form method="post" action={`/admin/reports/${report.id}/dismiss`}>
                        <input name="note" maxLength={500} aria-label="Optional dismissal note"
                          placeholder="optional note" />
                        <button className="quiet">dismiss</button>
                      </form>
                      {!report.post_deleted_at && (
                        <a className="quiet danger" href={`/admin/posts/${report.post_id}/delete?report=${report.id}`}>
                          delete post
                        </a>
                      )}
                      <a className="quiet danger" href={`/admin/users/${report.author_id}`}>moderate user</a>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )
          : <div className="empty admin-empty">No {status} reports.</div>}
        <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={`/admin?status=${status}`} />
      </section>
      <section className="admin-section admin-suspended">
        <h2>
          suspended users <span>{stats.suspendedUsers}</span>
        </h2>
        {suspended.length
          ? (
            <div className="admin-user-list">
              {suspended.map(target => (
                <article key={target.id}>
                  <a href={`/u/${target.handle}`}>@{target.handle}</a>
                  <span>{target.suspended_at && fmtFull(target.suspended_at)}</span>
                  <a className="quiet" href={`/admin/users/${target.id}`}>review</a>
                </article>
              ))}
            </div>
          )
          : <p className="section-empty">No suspended users.</p>}
      </section>
      <section className="admin-section admin-actions-log">
        <h2>recent admin actions</h2>
        {actions.length
          ? actions.map(action => (
            <article key={action.id}>
              <span>
                <a href={`/u/${action.actor_handle}`}>@{action.actor_handle}</a> {action.action.replaceAll('_', ' ')}
              </span>
              <span>
                {action.target_handle && `@${action.target_handle}`}
                {action.target_post_id && ` post #${action.target_post_id}`}
              </span>
              {action.note && <p>{action.note}</p>}
              <time dateTime={action.created_at}>{fmtFull(action.created_at)}</time>
            </article>
          ))
          : <p className="section-empty">No moderation actions yet.</p>}
      </section>
    </Layout>
  )
}

export function AdminConfirm({ user, kind, target, post, returnTo = '/admin' }: {
  user: User
  kind: 'delete_post' | 'suspend_user' | 'restore_user' | 'delete_user'
  target?: ProfileRow
  post?: PostRow & { handle?: string }
  returnTo?: string
}) {
  const copy = kind === 'delete_post'
    ? ['Delete this post?', 'The post becomes a permanent tombstone; replies remain.']
    : kind === 'suspend_user'
    ? [`Suspend @${target!.handle}?`,
      'Their sessions will end and they cannot log in until restored. Content remains visible.']
    : kind === 'restore_user'
    ? [`Restore @${target!.handle}?`, 'They will be able to log in and use the account again.']
    : [`Permanently delete @${target!.handle}?`,
      'This anonymizes the account and turns all of its posts into tombstones. It cannot be undone.']
  const action = kind === 'delete_post'
    ? `/admin/posts/${post!.id}/delete`
    : `/admin/users/${target!.id}/${kind.replace('_user', '')}`
  return (
    <Layout user={user} title="admin moderation">
      <div className="panel confirm-delete admin-confirm">
        <p className="eyebrow">admin moderation</p>
        <h1>{copy[0]}</h1>
        <p>{copy[1]}</p>
        {post && <blockquote>{post.body}</blockquote>}
        <form method="post" action={action}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            moderation note (optional)
            <textarea name="note" maxLength={500} placeholder="Context for the audit log…" />
          </label>
          <div className="form-actions">
            <a className="quiet" href={returnTo}>cancel</a>
            <button className={`button ${kind.includes('delete') || kind === 'suspend_user' ? 'delete-button' : ''}`}>
              {kind.replaceAll('_', ' ')}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function AdminUser({ user, target }: { user: User; target: ProfileRow }) {
  const protectedAdmin = isAdminEmail(target.email)
  return (
    <Layout user={user} title={`moderate @${target.handle}`}>
      <section className="page-header profile admin-user-header">
        <div className="profile-content">
          <p className="eyebrow">admin moderation</p>
          <h1>@{target.handle}</h1>
          <p>{target.email}</p>
          <p>{target.suspended_at ? `Suspended ${fmtFull(target.suspended_at)}` : 'Account active'}</p>
        </div>
        <div className="profile-action">
          <a href={`/u/${target.handle}`}>view profile</a>
        </div>
      </section>
      {protectedAdmin
        ? <div className="empty relationship-notice">Hardcoded admin accounts are protected from moderation.</div>
        : (
          <section className="admin-user-actions">
            <a className={`button ${target.suspended_at ? '' : 'delete-button'}`}
              href={`/admin/users/${target.id}/${target.suspended_at ? 'restore' : 'suspend'}`}
            >
              {target.suspended_at ? 'restore account' : 'suspend account'}
            </a>
            <a className="quiet danger" href={`/admin/users/${target.id}/delete`}>permanently delete account</a>
          </section>
        )}
    </Layout>
  )
}

function FeedTabs({ active, user }: { active: 'following' | 'hot' | 'latest'; user: User | null }) {
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

export function About({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="about">
      <article className="static-page">
        <p className="eyebrow">about</p>
        <h1>A quieter place for your thoughts.</h1>
        <p>
          root.mx is a simple social text log: write short notes, follow people and hashtags, and join conversations
          without turning every thought into a performance.
        </p>
        <p>
          Posts are limited to 280 characters. That constraint is intentional—it keeps the site quick to read and
          encourages people to say one thing at a time.
        </p>
        <h2>Be a good neighbour</h2>
        <p>
          Share what is yours to share, treat other people with respect, and don’t use the service for harassment,
          abuse, spam, impersonation, or anything unlawful. We may moderate or remove content that puts the community or
          the service at risk.
        </p>
      </article>
    </Layout>
  )
}

export function Legal({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="legal">
      <article className="static-page">
        <p className="eyebrow">legal</p>
        <h1>Terms, privacy &amp; liability</h1>
        <p className="legal-updated">Last updated: August 3, 2026</p>

        <h2>Your content and conduct</h2>
        <p>
          You keep ownership of content you post. By posting, you give root.mx permission to host, display, and
          distribute that content as needed to operate the service. You are responsible for your account, your content,
          and ensuring that your use of the service follows applicable law and does not infringe anyone else’s rights.
        </p>

        <h2>Service availability</h2>
        <p>
          root.mx is provided “as is” and “as available,” without warranties of any kind. We do not promise that the
          service will always be available, secure, accurate, or free of errors. Features may change, and content or
          accounts may be suspended or removed when necessary to operate or protect the service.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, root.mx and its operators will not be liable for indirect, incidental,
          special, consequential, or punitive damages, or for lost data, profits, goodwill, or other losses resulting
          from your use of—or inability to use—the service or from content posted by others. Nothing here excludes
          liability that cannot legally be excluded.
        </p>

        <h2>Privacy</h2>
        <p>
          We process account details, posts, and basic technical information needed to provide, secure, and improve the
          service. Public posts, handles, and profiles can be seen by anyone. Do not post sensitive information you want
          to keep private. We do not sell your personal information.
        </p>

        <h2>Changes</h2>
        <p>
          These terms may be updated as the service evolves. Continued use after an update means you accept the revised
          terms. If you do not agree with these terms, please stop using the service.
        </p>
      </article>
    </Layout>
  )
}

export function Feed({ user, page, title }: { user: User; page: number; title?: string }) {
  const total = (db.query(
    `SELECT count(*) AS count FROM posts p WHERE p.deleted_at IS NULL AND (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))`,
  ).get(user.id, user.id, user.id, user.id, user.id) as { count: number }).count
  const totalPages = Math.ceil(total / pageSize)
  const posts = enrichPosts(db, db.query(
    `SELECT p.*,u.handle, EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=p.user_id) following FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, pageSize, (page - 1) * pageSize) as PostView[], user.id)
  return (
    <Layout user={user} title={title}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user} />
      {posts.length
        ? posts.map(p => <Post key={p.id} p={p} user={user} showReplyCount />)
        : total === 0
        ? (
          <div className="empty empty-actions">
            <p>Your timeline is empty. Follow people or hashtags to shape it.</p>
            <div>
              <a className="button" href="/explore">explore</a>
              <a href="/latest">browse latest</a>
              <a href="/compose">write your first note</a>
            </div>
          </div>
        )
        : (
          <div className="empty">
            No notes on this page. <a href="/for-you">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={totalPages} path="/for-you" />
    </Layout>
  )
}

export function PublicFeed(
  { page, user = null, path = '/' }: { page: number; user?: User | null; path?: string },
) {
  const viewerId = user?.id ?? -1
  const total = (db.query(`SELECT count(*) AS count FROM posts p WHERE deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
    .get(viewerId, viewerId, viewerId) as { count: number }).count
  const posts = enrichPosts(db, db.query(
    `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
      (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).all(viewerId, viewerId, viewerId, pageSize, (page - 1) * pageSize) as PostView[], viewerId)
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined}>
      <h1 className="visually-hidden">Latest notes</h1>
      <FeedTabs active="latest" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href={path}>Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={path} />
    </Layout>
  )
}

export function HotFeed({ page, user, title }: { page: number; user: User | null; title?: string }) {
  const viewerId = user?.id ?? -1
  const total = (db.query(`SELECT count(*) AS count FROM posts p WHERE deleted_at IS NULL AND (? < 0 OR NOT EXISTS
    (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
      OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`)
    .get(viewerId, viewerId, viewerId) as { count: number }).count
  const posts = enrichPosts(db, getHotPosts(db, pageSize, (page - 1) * pageSize, new Date(), viewerId), viewerId)
  return (
    <Layout user={user} title={title}>
      <h1 className="visually-hidden">Hot notes</h1>
      <FeedTabs active="hot" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <GlobalFeedEmpty user={user} />
        : (
          <div className="empty">
            No notes on this page. <a href="/hot">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path="/hot" />
    </Layout>
  )
}

export function Activity({ user, page }: { user: User; page: number }) {
  const total = activityTotal(user.id)
  const posts = db.query(
    `SELECT * FROM (
      SELECT p.*,u.handle,CASE WHEN parent.user_id=? THEN 'reply' ELSE 'mention' END activity_kind,
        NULL bio,NULL posts,NULL viewerFollowing
        FROM posts p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN posts parent ON parent.id=p.parent_id
        LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
        WHERE ${activityPostWhere}
        GROUP BY p.id
      UNION ALL
      SELECT NULL id,f.follower_id user_id,NULL parent_id,NULL body,f.created_at,NULL deleted_at,
        u.handle,'follow' activity_kind,u.bio,
        (SELECT count(*) FROM posts fp WHERE fp.user_id=u.id AND fp.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing
        FROM follows f JOIN users u ON u.id=f.follower_id
        WHERE f.following_id=? AND f.created_at IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
            OR (b.blocker_id=f.follower_id AND b.blocked_id=?))
      ) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, pageSize,
    (page - 1) * pageSize) as (PostView & { activity_kind: 'reply' | 'mention' | 'follow'; posts: number | null;
      viewerFollowing: boolean | null; bio: string | null })[]
  const activity = enrichPosts(db, posts.filter(post => post.activity_kind !== 'follow'), user.id)
  const activityById = new Map(activity.map(post => [post.id, post]))
  return (
    <Layout user={user} title="activity">
      <section className="page-header activity-header">
        <h1>activity</h1>
      </section>
      {posts.length
        ? posts.map((rawPost, index) => {
          const post = rawPost.activity_kind === 'follow' ? rawPost : activityById.get(rawPost.id)!
          return (
            <div className="activity-item"
              key={rawPost.activity_kind === 'follow' ? `follow-${rawPost.user_id}-${index}` : rawPost.id}
            >
              <div className="activity-context">
                {rawPost.activity_kind === 'reply'
                  ? 'replied to you'
                  : rawPost.activity_kind === 'mention'
                  ? 'mentioned you'
                  : 'followed you'}
              </div>
              {rawPost.activity_kind === 'follow'
                ? (
                  <div className="post people activity-follow">
                    <article className="activity-person">
                      <div>
                        <div>
                          <a href={'/u/' + rawPost.handle}>@{rawPost.handle}</a>
                          <small>{rawPost.posts} {rawPost.posts === 1 ? 'note' : 'notes'}</small>
                        </div>
                        <form method="post" action={'/follow/' + rawPost.handle}>
                          <button className={`button${rawPost.viewerFollowing ? ' unfollow-button' : ''}`}>
                            {rawPost.viewerFollowing ? 'unfollow' : 'follow'}
                          </button>
                        </form>
                      </div>
                      <p className="profile-bio">{rawPost.bio || 'No bio yet.'}</p>
                    </article>
                  </div>
                )
                : <Post p={post} user={user} showReplyCount />}
            </div>
          )
        })
        : total === 0
        ? (
          <div className="empty empty-actions">
            <p>No activity yet.</p>
            <div>
              <a className="button" href="/latest">browse latest</a>
              <a href="/compose">write a note</a>
            </div>
          </div>
        )
        : (
          <div className="empty">
            No activity on this page. <a href="/activity">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path="/activity" />
    </Layout>
  )
}

export function Auth(
  { mode, error, success, handle = '', email = '', next }: { mode: 'login' | 'signup'; error?: string; success?: string;
    handle?: string; email?: string; next?: string },
) {
  return (
    <Layout title={mode === 'login' ? 'log in' : 'sign up'}>
      <div className="panel auth">
        <form method="post" action={'/' + mode}>
          {next && <input type="hidden" name="next" value={next} />}
          <FormMessage error={error} success={success} />
          {mode === 'signup' && (
            <label>
              email<input type="email" name="email" required maxLength={254} autoComplete="email" autoFocus
                defaultValue={email} placeholder="you@example.com" />
            </label>
          )}
          <label>
            {mode === 'login' ? 'email or handle' : 'handle'}
            <input name="handle" required pattern={mode === 'signup' ? '[A-Za-z0-9_]{2,24}' : undefined}
              maxLength={mode === 'login' ? 254 : undefined} autoComplete="username" autoFocus={mode === 'login'}
              defaultValue={handle} placeholder={mode === 'login' ? 'you@example.com or your_handle' : 'your_handle'} />
          </label>
          <label>
            password<input type="password" name="password" required minLength={8} placeholder="8+ characters" />
          </label>
          <button className="button wide">{mode === 'signup' ? 'create account →' : 'log in →'}</button>
        </form>
        <p className="switch">
          {mode === 'signup'
            ? (
              <>
                Already here? <a href="/login">Log in</a>
              </>
            )
            : (
              <>
                New here? <a href="/signup">Create an account</a> · <a href="/forgot-password">Forgot password?</a>
              </>
            )}
        </p>
      </div>
    </Layout>
  )
}

export function ForgotPassword({ sent = false, error }: { sent?: boolean; error?: string }) {
  return (
    <Layout title="forgot password">
      <div className="panel auth">
        {sent
          ? (
            <>
              <h1>Check your email</h1>
              <p className="switch">
                If an account uses that address, a password reset link is on its way. It expires in one hour.
              </p>
            </>
          )
          : (
            <>
              <form method="post" action="/forgot-password">
                <FormMessage error={error} />
                <label>
                  email<input type="email" name="email" required maxLength={254} autoComplete="email"
                    placeholder="you@example.com" />
                </label>
                <button className="button wide">send reset link →</button>
              </form>
              <p className="switch">
                <a href="/login">Back to login</a>
              </p>
            </>
          )}
      </div>
    </Layout>
  )
}

export function ResetPassword(
  { resetToken, error, invalid = false }: { resetToken?: string; error?: string; invalid?: boolean },
) {
  return (
    <Layout title="reset password">
      <div className="panel auth">
        {invalid
          ? (
            <>
              <h1>Link unavailable</h1>
              <p className="switch">
                This reset link is invalid or has expired. <a href="/forgot-password">Request another link</a>.
              </p>
            </>
          )
          : (
            <form method="post" action="/reset-password">
              <FormMessage error={error} />
              <input type="hidden" name="token" value={resetToken} />
              <label>
                new password<input type="password" name="password" required minLength={8} autoComplete="new-password"
                  placeholder="8+ characters" />
              </label>
              <label>
                confirm password<input type="password" name="confirmPassword" required minLength={8}
                  autoComplete="new-password" />
              </label>
              <button className="button wide">reset password →</button>
            </form>
          )}
      </div>
    </Layout>
  )
}

export function AccountSecurity({ user, sessions, error, success }: {
  user: User
  sessions: SessionView[]
  error?: string
  success?: string
}) {
  return (
    <Layout user={user} title="account security">
      <section className="page-header security-header">
        <div>
          <p className="eyebrow">account</p>
          <h1>security</h1>
        </div>
      </section>
      <div className="security-page">
        <FormMessage error={error} success={success} />
        <section className="security-section">
          <h2>email</h2>
          <p>{user.email} · {user.email_verified_at ? 'verified' : 'not verified'}</p>
          {!user.email_verified_at && (
            <form method="post" action="/account/email/verify">
              <button className="button">send verification email</button>
            </form>
          )}
          <form className="security-form" method="post" action="/account/email/change">
            <label>
              new email
              <input type="email" name="email" required maxLength={254} autoComplete="email" />
            </label>
            <label>
              current password
              <input type="password" name="password" required autoComplete="current-password" />
            </label>
            <button className="button">confirm new email →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>password</h2>
          <form className="security-form" method="post" action="/account/password">
            <label>
              current password
              <input type="password" name="currentPassword" required autoComplete="current-password" />
            </label>
            <label>
              new password
              <input type="password" name="password" required minLength={8} autoComplete="new-password" />
            </label>
            <label>
              confirm new password
              <input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" />
            </label>
            <button className="button">change password →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>sessions</h2>
          <div className="session-list">
            {sessions.map(session => (
              <article key={session.token}>
                <div>
                  <strong>{session.current ? 'this session' : 'signed-in session'}</strong>
                  <span>{session.user_agent || 'Unknown browser'} · expires{' '}
                    <time dateTime={new Date(session.expires_at).toISOString()}>
                      {new Date(session.expires_at).toLocaleDateString('en')}
                    </time>
                  </span>
                </div>
                {!session.current && (
                  <form method="post" action="/account/sessions/revoke">
                    <input type="hidden" name="token" value={session.token} />
                    <button className="quiet danger">revoke</button>
                  </form>
                )}
              </article>
            ))}
          </div>
          {sessions.length > 1 && (
            <form method="post" action="/account/sessions/revoke-others">
              <button className="quiet danger">revoke all other sessions</button>
            </form>
          )}
        </section>
      </div>
    </Layout>
  )
}

export function Compose({ user, error, body = '' }: { user: User; error?: string; body?: string }) {
  return (
    <Layout user={user} title="write">
      <div className="panel compose write-compose">
        <form method="post" action="/post">
          <FormMessage error={error} />
          <textarea name="body" maxLength={280} required autoFocus defaultValue={body}
            placeholder="What's on your mind?" />
          <div className="composefoot">
            <span>280 characters max · use #hashtags and @mentions</span>
            <button className="button">post →</button>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function EditPost(
  { user, post, error, body = post.body }: { user: User; post: PostRow; error?: string; body?: string },
) {
  return (
    <Layout user={user} title="edit post">
      <div className="panel compose">
        <form method="post" action={'/post/' + post.id + '/edit'}>
          <FormMessage error={error} />
          <textarea name="body" maxLength={280} required autoFocus defaultValue={body} />
          <div className="composefoot">
            <span>280 characters max</span>
            <div className="form-actions">
              <a className="quiet" href={'/post/' + post.id}>cancel</a>
              <button className="button">save changes →</button>
            </div>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function ConfirmDelete({ user, post }: { user: User; post: PostRow }) {
  return (
    <Layout user={user} title="delete post">
      <div className="panel confirm-delete">
        <h1>Delete this post?</h1>
        <p>Its replies will remain, with this post shown as “(deleted)” when quoted.</p>
        <blockquote>{post.body}</blockquote>
        <div className="form-actions">
          <a className="quiet" href={'/post/' + post.id}>cancel</a>
          <form method="post" action={'/post/' + post.id + '/delete'}>
            <button className="button delete-button" type="submit">delete post</button>
          </form>
        </div>
      </div>
    </Layout>
  )
}

export function ConfirmAccountDelete({ user, error }: { user: User; error?: string }) {
  return (
    <Layout user={user} title="delete account">
      <div className="panel confirm-delete">
        <h1>Delete your account?</h1>
        <p>
          This cannot be undone. Your profile and account data will be removed, and all your notes will become
          “(deleted)” tombstones so existing conversations remain readable.
        </p>
        <form className="account-delete-form" method="post" action="/account/delete">
          <FormMessage error={error} />
          <label>
            confirm your password
            <input type="password" name="password" required autoComplete="current-password" autoFocus />
          </label>
          <div className="form-actions">
            <a className="quiet" href={`/u/${user.handle}?edit=1`}>cancel</a>
            <button className="button delete-button" type="submit">delete account</button>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function Reply(
  { user, post, showForm, showReport = false, reported = false, error, body = '', social }: { user: User;
    post: PostView; showForm: boolean; showReport?: boolean; reported?: boolean; error?: string;
    social?: { description: string; image: string; url: string }; body?: string },
) {
  return (
    <Layout user={user} title={postTitle(post.body)} social={social}>
      <div className="thread-root">
        <Post p={post} user={user} showReplyAction={!showForm} showOwnerActions showModerateAction
          reportHref={user.id !== post.user_id && !showReport && !reported ? `/post/${post.id}?report=1` : undefined} />
      </div>
      {user.id !== post.user_id && <ReportPanel post={post} showForm={showReport} reported={reported} />}
      {showForm && (
        <div className="panel replybox">
          <form method="post" action={'/post/' + post.id + '/reply'}>
            <FormMessage error={error} />
            <textarea name="body" maxLength={280} required autoFocus defaultValue={body}
              placeholder={'Reply to @' + post.handle + '…'} />
            <div className="composefoot">
              <span>280 characters max</span>
              <button className="button">post →</button>
            </div>
          </form>
        </div>
      )}
      <ThreadReplies parentId={post.id} user={user} />
    </Layout>
  )
}

export function Explore({ user, welcome = false, peopleIds }: {
  user: User | null
  welcome?: boolean
  peopleIds?: number[]
}) {
  const viewerId = user?.id ?? -1
  const savedIds = peopleIds?.filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index)
    .slice(0, 6)
  const people = savedIds?.length
    ? (db.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following
        FROM users u WHERE u.id IN (${savedIds.map(() => '?').join(',')}) AND u.deleted_at IS NULL
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`,
    ).all(viewerId, ...savedIds, viewerId, viewerId, viewerId) as PersonView[])
      .sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id))
    : db.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
       EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following FROM users u
       WHERE u.id != ? AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id)
       AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
         (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
       AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) ORDER BY RANDOM() LIMIT 6`,
    ).all(viewerId, viewerId, viewerId, viewerId, viewerId, viewerId) as PersonView[]
  const explorePeople = people.map(p => p.id).join(',')
  const tags = db.query(
    `SELECT ph.tag,count(*) count,
      EXISTS(SELECT 1 FROM hashtag_follows hf WHERE hf.user_id=? AND hf.tag=ph.tag) following
      FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
      WHERE p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
      GROUP BY ph.tag ORDER BY count DESC LIMIT 12`,
  ).all(viewerId, viewerId, viewerId, viewerId) as { tag: string; count: number; following: boolean }[]
  return (
    <Layout user={user} title="explore">
      {user && welcome && (
        <section className="welcome-panel" role="status">
          <p className="eyebrow">welcome to root.mx</p>
          <h1>Make this place yours.</h1>
          <p>Follow a few people or hashtags below, or start with a note of your own.</p>
          <div className="welcome-actions">
            <a className="button" href="/compose">write your first note →</a>
            <a href="/latest">browse latest</a>
          </div>
        </section>
      )}
      <div className="columns">
        <section>
          <h2>Popular tags</h2>
          {tags.length
            ? <TagPeopleList user={user} tags={tags} />
            : <p className="section-empty">No hashtags yet.</p>}
        </section>
        <section>
          <h2>{user ? 'People to follow' : 'People'}</h2>
          <div className="people">
            {people.map(p => (
              <article key={p.id}>
                <div>
                  <div>
                    <a href={'/u/' + p.handle}>@{p.handle}</a>
                    <small>{p.posts} {p.posts === 1 ? 'note' : 'notes'}</small>
                  </div>
                  {user && (
                    <form method="post" action={'/follow/' + p.handle}>
                      <input type="hidden" name="explorePeople" value={explorePeople} />
                      <button className={`button${p.following ? ' unfollow-button' : ''}`}>
                        {p.following ? 'unfollow' : 'follow'}
                      </button>
                    </form>
                  )}
                </div>
                <p className="profile-bio">{p.bio || 'No bio yet.'}</p>
              </article>
            ))}
            {!people.length && <p className="section-empty">No people to suggest yet.</p>}
          </div>
        </section>
      </div>
    </Layout>
  )
}

export function Profile(
  { user, profile, posts, following, bio = profile.bio || '', editHandle = profile.handle, editEmail = profile.email,
    error, editing = false, page = 1, total = posts.length, followerCount = 0, followingCount = 0,
    followingTagCount = 0, blocked = false, blockedByProfile = false, social }: {
      user: User | null
      profile: ProfileRow
      posts: PostView[]
      following: boolean
      bio?: string
      editHandle?: string
      editEmail?: string
      error?: string
      editing?: boolean
      page?: number
      total?: number
      followerCount?: number
      followingCount?: number
      followingTagCount?: number
      blocked?: boolean
      blockedByProfile?: boolean
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`@${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} blocked={blocked} editing={editing}>
        <div className="profile-content">
          <h1>@{profile.handle}</h1>
          {user?.id === profile.id && editing
            ? (
              <>
                <form className="bio-form" method="post" action={'/u/' + profile.handle + '/profile'}>
                  <FormMessage error={error} />
                  <label>
                    handle<input name="handle" required pattern="[A-Za-z0-9_]{2,24}" defaultValue={editHandle} />
                  </label>
                  <label>
                    bio<textarea name="bio" maxLength={160} defaultValue={bio}
                      placeholder="Tell people a little about yourself…" />
                  </label>
                  <div className="composefoot">
                    <span>160 characters max</span>
                    <button className="button">save profile →</button>
                  </div>
                </form>
                <div className="account-danger-zone">
                  <div>
                    <strong>Account security</strong>
                    <span>Manage your email, password, and signed-in sessions.</span>
                  </div>
                  <a className="button" href="/account/security">manage security</a>
                </div>
                <div className="account-danger-zone">
                  <div>
                    <strong>Delete account</strong>
                    <span>Permanently remove your profile and turn your notes into deleted tombstones.</span>
                  </div>
                  <a className="button delete-button" href="/account/delete">delete account</a>
                </div>
              </>
            )
            : <p className="profile-bio">{profile.bio || 'No bio yet.'}</p>}
        </div>
      </ProfileHeader>
      {blocked || blockedByProfile
        ? (
          <div className="empty relationship-notice">
            {blocked ? 'You blocked this user. Unblock them to see their notes.' : 'This profile is unavailable.'}
          </div>
        )
        : !editing && (
          <ProfileTabs profile={profile} active="notes" notes={total} followers={followerCount}
            following={followingCount} followingTags={followingTagCount} />
        )}
      {!editing && !blocked && !blockedByProfile && posts.map(post => <Post key={post.id} p={post} user={user} />)}
      {!editing && !blocked && !blockedByProfile
        && <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={'/u/' + profile.handle} />}
    </Layout>
  )
}

function ProfileHeader({ user, profile, following, blocked = false, editing = false, children }: {
  user: User | null
  profile: ProfileRow
  following: boolean
  blocked?: boolean
  editing?: boolean
  children?: React.ReactNode
}) {
  return (
    <section className={`page-header profile${editing ? ' profile-editing' : ''}`}>
      {children || (
        <div className="profile-content">
          <h1>@{profile.handle}</h1>
          <p className="profile-bio">{profile.bio || 'No bio yet.'}</p>
        </div>
      )}
      <div className="profile-action">
        {isAdmin(user) && user?.id !== profile.id && (
          <a className="quiet danger" href={`/admin/users/${profile.id}`}>
            moderate
          </a>
        )}
        {user?.id === profile.id && !editing && (
          <>
            <a className="profile-edit-link" href={'/u/' + profile.handle + '?edit=1'}>edit</a>
            <form method="post" action="/logout">
              <button className="profile-edit-link profile-logout">logout</button>
            </form>
          </>
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

function ProfileTabs({ profile, active, notes, followers, following, followingTags }: {
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

export function Connections(
  { user, profile, people, tags = [], kind, page, total, noteCount, followerCount, followingCount, followingTagCount,
    following, social }: {
      user: User | null
      profile: ProfileRow
      people: PersonView[]
      tags?: { tag: string; count: number; viewerFollowing: boolean }[]
      kind: 'following' | 'followers'
      page: number
      total: number
      noteCount: number
      followerCount: number
      followingCount: number
      followingTagCount: number
      following: boolean
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} followers={followerCount}
        following={followingCount} followingTags={followingTagCount} />
      {kind === 'following' && (people.length || tags.length)
        ? (
          <div className="columns connections-columns">
            <section>
              <h2>Tags</h2>
              {tags.length
                ? <TagPeopleList user={user} tags={tags} followingKey="viewerFollowing" />
                : <div className="empty connections-empty">No followed tags yet.</div>}
            </section>
            <section>
              <h2>People</h2>
              {people.length
                ? <ConnectionPeople user={user} people={people} />
                : <div className="empty connections-empty">No followed people yet.</div>}
            </section>
          </div>
        )
        : people.length
        ? <ConnectionPeople user={user} people={people} className="connections-list" />
        : (
          <div className="empty">
            @{profile.handle} {kind === 'following' ? 'isn’t following anyone yet.' : 'has no followers yet.'}
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={`/u/${profile.handle}?tab=${kind}`} />
    </Layout>
  )
}

function TagPeopleList({ user, tags, followingKey = 'following' }: {
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

function ConnectionPeople({ user, people, className = '' }: {
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

export function TagFeed(
  { user, tag, following, posts, page, total, social }: { user: User | null; tag: string; following: boolean;
    posts: PostView[]; page: number; total: number;
    social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
      imageAlt?: string } },
) {
  return (
    <Layout user={user} title={`#${tag}`} social={social}>
      <section className="page-header tag-header">
        <h1>
          <span>#{tag}</span>
          <span className="tag-note-count" aria-label={`${total} ${total === 1 ? 'note' : 'notes'}`}>
            {total}
          </span>
        </h1>
        {user
          ? (
            <form method="post" action={'/tag-follow/' + tag}>
              <button className={`button${following ? ' unfollow-button' : ''}`}>
                {following ? 'unfollow' : 'follow'}
              </button>
            </form>
          )
          : <a className="button" href="/login">log in to follow</a>}
      </section>
      {posts.length
        ? posts.map(post => <Post p={post} user={user} key={post.id} />)
        : <div className="empty">No notes use this hashtag yet.</div>}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={'/tag/' + tag} />
    </Layout>
  )
}

export function PublicThread(
  { post, social }: { post: PostView; social?: { description: string; image: string; url: string } },
) {
  return (
    <Layout title={postTitle(post.body)} social={social}>
      <div className="thread-root">
        <Post p={post} user={null} replyHref={'/login?next=' + encodeURIComponent('/post/' + post.id + '?reply=1')}
          replyLabel="log in to reply" />
      </div>
      <ThreadReplies parentId={post.id} user={null} />
    </Layout>
  )
}

function ReportPanel({ post, showForm, reported }: { post: PostView; showForm: boolean; reported: boolean }) {
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

function GlobalFeedEmpty({ user }: { user: User | null }) {
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
