import { translationLanguages } from '../translation'
import type { User } from '../types'
import type { PostRow, ProfileRow } from '../types'
import { displayPostBody } from '../utils'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { Panel } from './panel'
import { Post } from './post'

export function AdminTranslate({ user, post, returnTo }: {
  user: User
  post: PostRow & { handle?: string }
  returnTo: string
}) {
  return (
    <Layout user={user} title="translate post">
      <Panel className="admin-confirm">
        <p className="eyebrow">admin moderation</p>
        <h1>Translate this post</h1>
        <p>Select the language this post is written in. Google will translate it into English.</p>
        <blockquote>{displayPostBody(post.body)}</blockquote>
        <form method="post" action={`/admin/posts/${post.id}/translate`}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            source language
            <select className="form-control form-select" name="source" defaultValue="" required>
              <option value="" disabled>select language</option>
              {translationLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <FormActions secondary={<a className="secondary-action cancel-action" href={returnTo}>cancel</a>}
            primary={<button className="button">translate</button>} />
        </form>
      </Panel>
    </Layout>
  )
}

export function AdminPostModeration({ user, post, returnTo }: {
  user: User
  post: PostRow & { handle: string }
  returnTo: string
}) {
  return (
    <Layout user={user} title="moderate post">
      <header className="page-header moderation-header">
        <div>
          <p className="eyebrow">admin moderation</p>
          <h1>Review post</h1>
        </div>
        <a className="quiet" href={returnTo}>back</a>
      </header>
      <section className="moderation-post" aria-label="Post under review">
        <Post p={post} user={user} suppressContentWarning showReadAction={false} />
      </section>
      <section className="moderation-actions" aria-label="Moderation actions">
        <div className="moderation-status">
          <div>
            <h2>Status</h2>
            {post.moderation_category
              ? (
                <p>
                  {post.moderation_score != null ? 'Automatically hidden' : 'Hidden'} behind a content warning for{' '}
                  <strong>{post.moderation_category}</strong>
                  {post.moderation_score != null && ` (score ${post.moderation_score.toFixed(2)})`}.
                </p>
              )
              : <p>This post is currently visible without a content warning.</p>}
          </div>
          {post.moderation_category && (
            <form method="post" action={`/admin/posts/${post.id}/moderate`}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="action" value="unmark" />
              <button className="button" type="submit">remove warning</button>
            </form>
          )}
        </div>
        <form className="moderation-mark-form" method="post" action={`/admin/posts/${post.id}/moderate`}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="action" value="mark" />
          <label htmlFor="moderation-category">Content warning</label>
          <p>Describe the trigger briefly. This text will be shown to readers.</p>
          <div>
            <input className="form-control" id="moderation-category" name="category" maxLength={100} required
              defaultValue={post.moderation_category || ''} placeholder="e.g. graphic violence" autoComplete="off" />
            <button className="button" type="submit">
              {post.moderation_category ? 'update warning' : 'add warning'}
            </button>
          </div>
        </form>
        <nav className="moderation-other-actions" aria-label="Other post actions">
          <a className="quiet" href={`/post/${post.id}`}>view post</a>
          <a className="quiet" href={`/admin/posts/${post.id}/translate?from=${encodeURIComponent(returnTo)}`}>
            translate
          </a>
          <a className="quiet danger" href={`/admin/posts/${post.id}/delete?from=${encodeURIComponent(returnTo)}`}>
            delete post
          </a>
        </nav>
      </section>
    </Layout>
  )
}

export function AdminConfirm({ user, kind, target, post, returnTo = '/admin' }: {
  user: User
  kind: 'delete_post' | 'suspend_user' | 'restore_user' | 'delete_user' | 'drop_username'
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
    : kind === 'drop_username'
    ? [`Drop @${target!.handle}?`,
      'The username will be permanently banned. Their account will get a temporary anonymous name and must choose again.']
    : [`Permanently delete @${target!.handle}?`,
      'This anonymizes the account and turns all of its posts into tombstones. It cannot be undone.']
  const action = kind === 'delete_post'
    ? `/admin/posts/${post!.id}/delete`
    : `/admin/users/${target!.id}/${kind === 'drop_username' ? 'drop-username' : kind.replace('_user', '')}`
  return (
    <Layout user={user} title="admin moderation">
      <Panel className="confirm-delete admin-confirm">
        <p className="eyebrow">admin moderation</p>
        <h1>{copy[0]}</h1>
        <p>{copy[1]}</p>
        {post && <blockquote>{displayPostBody(post.body)}</blockquote>}
        <form method="post" action={action}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label>
            moderation note (optional)
            <textarea name="note" maxLength={500} placeholder="Context for the audit log…" autoComplete="off"
              inputMode="text" enterkeyhint="enter" />
          </label>
          <FormActions secondary={<a className="secondary-action cancel-action" href={returnTo}>cancel</a>}
            primary={
              <button className={`button ${
                kind.includes('delete') || kind === 'suspend_user'
                  || kind === 'drop_username'
                  ? 'button-danger'
                  : ''
              }`}>
                {kind.replaceAll('_', ' ')}
              </button>
            } />
        </form>
      </Panel>
    </Layout>
  )
}
