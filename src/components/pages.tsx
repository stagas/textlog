import React from 'react'
import { db, type User } from '../db'
import { getHotPosts } from '../hot'
import { Layout } from './layout'
import { Post, ThreadReplies } from './post'

const pageSize = 20
const postTitleLength = 60

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

function FeedTabs({ active, user }: { active: 'following' | 'hot' | 'latest'; user: User | null }) {
  return (
    <nav className="feed-tabs" aria-label="Feed">
      {user && (
        <a className={active === 'following' ? 'active' : ''} aria-current={active === 'following' ? 'page' : undefined}
          href="/"
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

export function Feed({ user, page }: { user: User; page: number }) {
  const total = (db.query(
    `SELECT count(*) AS count FROM posts p WHERE p.deleted_at IS NULL AND (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?))`,
  ).get(user.id, user.id, user.id) as { count: number }).count
  const totalPages = Math.ceil(total / pageSize)
  const posts = db.query(
    `SELECT p.*,u.handle, EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=p.user_id) following FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL AND (p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.id IN (SELECT ph.post_id FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag WHERE hf.user_id=?)) ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, pageSize, (page - 1) * pageSize) as any[]
  return (
    <Layout user={user}>
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
            No notes on this page. <a href="/">Return to the first page</a>.
          </div>
        )}
      <Pagination page={page} totalPages={totalPages} path="/" />
    </Layout>
  )
}

export function PublicFeed(
  { page, user = null, path = '/' }: { page: number; user?: User | null; path?: string },
) {
  const total =
    (db.query('SELECT count(*) AS count FROM posts WHERE deleted_at IS NULL').get() as { count: number }).count
  const posts = db.query(
    'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT ? OFFSET ?',
  ).all(pageSize, (page - 1) * pageSize) as any[]
  return (
    <Layout user={user} title={path === '/latest' ? 'latest' : undefined}>
      <FeedTabs active="latest" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <div className="empty">No notes have been posted yet.</div>
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
  const total =
    (db.query('SELECT count(*) AS count FROM posts WHERE deleted_at IS NULL').get() as { count: number }).count
  const posts = getHotPosts(db, pageSize, (page - 1) * pageSize)
  return (
    <Layout user={user} title={title}>
      <FeedTabs active="hot" user={user} />
      {posts.length
        ? posts.map(post => <Post key={post.id} p={post} user={user} showReplyCount />)
        : total === 0
        ? <div className="empty">No notes have been posted yet.</div>
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
  const postActivityWhere = `p.deleted_at IS NULL AND
    (parent.user_id=? OR (pm.user_id IS NOT NULL AND p.user_id != ?))`
  const postTotal = (db.query(
    `SELECT count(DISTINCT p.id) count FROM posts p
      LEFT JOIN posts parent ON parent.id=p.parent_id
      LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
      WHERE ${postActivityWhere}`,
  ).get(user.id, user.id, user.id) as { count: number }).count
  const followTotal = (db.query(
    'SELECT count(*) count FROM follows WHERE following_id=? AND created_at IS NOT NULL',
  ).get(user.id) as { count: number }).count
  const total = postTotal + followTotal
  const posts = db.query(
    `SELECT * FROM (
      SELECT p.*,u.handle,CASE WHEN parent.user_id=? THEN 'reply' ELSE 'mention' END activity_kind,
        NULL bio,NULL posts,NULL viewerFollowing
        FROM posts p
        JOIN users u ON u.id=p.user_id
        LEFT JOIN posts parent ON parent.id=p.parent_id
        LEFT JOIN post_mentions pm ON pm.post_id=p.id AND pm.user_id=?
        WHERE ${postActivityWhere}
        GROUP BY p.id
      UNION ALL
      SELECT NULL id,f.follower_id user_id,NULL parent_id,NULL body,f.created_at,NULL deleted_at,
        u.handle,'follow' activity_kind,u.bio,
        (SELECT count(*) FROM posts fp WHERE fp.user_id=u.id AND fp.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing
        FROM follows f JOIN users u ON u.id=f.follower_id
        WHERE f.following_id=? AND f.created_at IS NOT NULL
      ) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(user.id, user.id, user.id, user.id, user.id, user.id, pageSize, (page - 1) * pageSize) as any[]
  return (
    <Layout user={user} title="activity">
      <section className="page-header activity-header">
        <h1>activity</h1>
      </section>
      {posts.length
        ? posts.map((post, index) => (
          <div className="activity-item"
            key={post.activity_kind === 'follow' ? `follow-${post.user_id}-${index}` : post.id}>
            <div className="activity-context">
              {post.activity_kind === 'reply' ? 'replied to you'
                : post.activity_kind === 'mention' ? 'mentioned you'
                : 'followed you'}
            </div>
            {post.activity_kind === 'follow'
              ? (
                <div className="post people activity-follow">
                  <article className="activity-person">
                    <div>
                      <div>
                        <a href={'/u/' + post.handle}>@{post.handle}</a>
                        <small>{post.posts} {post.posts === 1 ? 'note' : 'notes'}</small>
                      </div>
                      <form method="post" action={'/follow/' + post.handle}>
                        <button className="button">{post.viewerFollowing ? 'unfollow' : 'follow'}</button>
                      </form>
                    </div>
                    <p className="profile-bio">{post.bio || 'No bio yet.'}</p>
                  </article>
                </div>
              )
              : <Post p={post} user={user} showReplyCount />}
          </div>
        ))
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
              email<input type="email" name="email" required maxLength={254} autoComplete="email" autoFocus defaultValue={email}
                placeholder="you@example.com" />
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

export function ForgotPassword({ sent = false }: { sent?: boolean }) {
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
  { user, post, error, body = post.body }: { user: User; post: any; error?: string; body?: string },
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

export function ConfirmDelete({ user, post }: { user: User; post: any }) {
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

export function ConfirmAccountDelete({ user }: { user: User }) {
  return (
    <Layout user={user} title="delete account">
      <div className="panel confirm-delete">
        <h1>Delete your account?</h1>
        <p>
          This cannot be undone. Your profile and account data will be removed, and all your notes will become
          “(deleted)” tombstones so existing conversations remain readable.
        </p>
        <div className="form-actions">
          <a className="quiet" href={`/u/${user.handle}?edit=1`}>cancel</a>
          <form method="post" action="/account/delete">
            <button className="button delete-button" type="submit">delete account</button>
          </form>
        </div>
      </div>
    </Layout>
  )
}

export function Reply(
  { user, post, showForm, error, body = '', social }: { user: User; post: any; showForm: boolean; error?: string;
    social?: { description: string; image: string; url: string }; body?: string },
) {
  return (
    <Layout user={user} title={postTitle(post.body)} social={social}>
      <div className="thread-root">
        <Post p={post} user={user} showReplyAction={!showForm} />
      </div>
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
  user: User | null; welcome?: boolean; peopleIds?: number[]
}) {
  const viewerId = user?.id ?? -1
  const savedIds = peopleIds?.filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index)
    .slice(0, 6)
  const people = savedIds?.length
    ? (db.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following
        FROM users u WHERE u.id IN (${savedIds.map(() => '?').join(',')}) AND u.deleted_at IS NULL`,
    ).all(viewerId, ...savedIds) as any[]).sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id))
    : db.query(
      'SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts, EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following FROM users u WHERE u.id != ? AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) AND EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) ORDER BY RANDOM() LIMIT 6',
    ).all(viewerId, viewerId, viewerId) as any[]
  const explorePeople = people.map(p => p.id).join(',')
  const tags = db.query('SELECT tag,count(*) count FROM post_hashtags GROUP BY tag ORDER BY count DESC LIMIT 12')
    .all() as any[]
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
          <div className="tags">
            {tags.map(t => (
              <a href={'/tag/' + t.tag} key={t.tag}>
                #{t.tag} <small>{t.count}</small>
              </a>
            ))}
          </div>
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
                      <button className="button">{p.following ? 'unfollow' : 'follow'}</button>
                    </form>
                  )}
                </div>
                <p className="profile-bio">{p.bio || 'No bio yet.'}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  )
}

export function Profile(
  { user, profile, posts, following, bio = profile.bio || '', editHandle = profile.handle, editEmail = profile.email,
    error, editing = false, page = 1, total = posts.length, followerCount = 0, followingCount = 0, social }: {
      user: User | null
      profile: any
      posts: any[]
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
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`@${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} editing={editing}>
        <div className="profile-content">
          <h1>@{profile.handle}</h1>
          {user?.id === profile.id && editing
            ? (
              <>
                <form className="bio-form" method="post" action={'/u/' + profile.handle + '/profile'}>
                  <FormMessage error={error} />
                  <label>
                    email<input type="email" name="email" required maxLength={254} autoComplete="email"
                      defaultValue={editEmail} />
                  </label>
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
      {!editing && <ProfileTabs profile={profile} active="notes" notes={total} followers={followerCount}
        following={followingCount} />}
      {posts.map(post => <Post key={post.id} p={post} user={user} />)}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={'/u/' + profile.handle} />
    </Layout>
  )
}

function ProfileHeader({ user, profile, following, editing = false, children }: {
  user: User | null; profile: any; following: boolean; editing?: boolean; children?: React.ReactNode
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
        {user?.id === profile.id && !editing && (
          <>
            <a className="profile-edit-link" href={'/u/' + profile.handle + '?edit=1'}>edit</a>
            <form method="post" action="/logout">
              <button className="profile-edit-link profile-logout">logout</button>
            </form>
          </>
        )}
        {user && user.id !== profile.id && (
          <form method="post" action={'/follow/' + profile.handle}>
            <button className="button">{following ? 'unfollow' : 'follow'} @{profile.handle}</button>
          </form>
        )}
        {!user && <a className="button" href="/login">log in to follow</a>}
      </div>
    </section>
  )
}

function ProfileTabs({ profile, active, notes, followers, following }: {
  profile: any; active: 'notes' | 'followers' | 'following'; notes: number; followers: number; following: number
}) {
  const base = `/u/${profile.handle}`
  return (
    <nav className="feed-tabs profile-tabs" aria-label={`@${profile.handle} profile`}>
      <a className={active === 'notes' ? 'active' : ''} aria-current={active === 'notes' ? 'page' : undefined}
        href={base}>{notes} {notes === 1 ? 'note' : 'notes'}</a>
      <a className={active === 'following' ? 'active' : ''}
        aria-current={active === 'following' ? 'page' : undefined} href={`${base}?tab=following`}>
        {following} following
      </a>
      <a className={active === 'followers' ? 'active' : ''}
        aria-current={active === 'followers' ? 'page' : undefined} href={`${base}?tab=followers`}>
        {followers} {followers === 1 ? 'follower' : 'followers'}
      </a>
    </nav>
  )
}

export function Connections(
  { user, profile, people, kind, page, total, noteCount, followerCount, followingCount, following, social }: {
    user: User | null; profile: any; people: any[]; kind: 'following' | 'followers'; page: number; total: number
    noteCount: number; followerCount: number; followingCount: number; following: boolean
    social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
  },
) {
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} followers={followerCount}
        following={followingCount} />
      {people.length
        ? (
          <div className="people connections-list">
            {people.map(person => (
              <article key={person.id}>
                <div>
                  <div>
                    <a href={`/u/${person.handle}`}>@{person.handle}</a>
                    <small>{person.posts} {person.posts === 1 ? 'note' : 'notes'}</small>
                  </div>
                  {user && user.id !== person.id && (
                    <form method="post" action={`/follow/${person.handle}`}>
                      <button className="button">{person.viewerFollowing ? 'unfollow' : 'follow'}</button>
                    </form>
                  )}
                </div>
                <p className="profile-bio">{person.bio || 'No bio yet.'}</p>
              </article>
            ))}
          </div>
        )
        : (
          <div className="empty">
            @{profile.handle} {kind === 'following' ? 'isn’t following anyone yet.' : 'has no followers yet.'}
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} path={`/u/${profile.handle}?tab=${kind}`} />
    </Layout>
  )
}

export function TagFeed(
  { user, tag, following, posts, page, total, social }: { user: User | null; tag: string; following: boolean;
    posts: any[]; page: number; total: number;
    social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website'; imageAlt?: string } },
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
              <button className="button">{following ? 'unfollow' : 'follow hashtag'}</button>
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
  { post, social }: { post: any; social?: { description: string; image: string; url: string } },
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
