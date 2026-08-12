import { type User } from '../db'
import type { PostRow, ProfileRow } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'

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
          <FormActions secondary={<a className="secondary-action" href={returnTo}>cancel</a>}
            primary={<button className={`button ${kind.includes('delete') || kind === 'suspend_user' ? 'button-danger' : ''}`}>
              {kind.replaceAll('_', ' ')}
            </button>} />
        </form>
      </div>
    </Layout>
  )
}
