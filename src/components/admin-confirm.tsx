import { translationLanguages } from '../translation'
import type { User } from '../types'
import type { PostRow, ProfileRow } from '../types'
import { displayPostBody } from '../utils'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { Panel } from './panel'

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
              inputMode="text" enterKeyHint="enter" />
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
