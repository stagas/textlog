import { isAdminEmail } from '../admin'
import type { User } from '../types'
import type { ProfileRow } from '../types'
import { fmtFull } from '../utils'
import { maskEmail } from './email-address'
import { Layout } from './layout'

export function AdminUser({ user, target }: { user: User; target: ProfileRow }) {
  const protectedAdmin = isAdminEmail(target.email)
  return (
    <Layout user={user} title={`moderate @${target.handle}`}>
      <section className="page-header profile admin-user-header">
        <div className="profile-content">
          <p className="eyebrow">admin moderation</p>
          <h1>@{target.handle}</h1>
          <p>{maskEmail(target.email)}</p>
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
            <a className={`button ${target.suspended_at ? '' : 'button-danger'}`}
              href={`/admin/users/${target.id}/${target.suspended_at ? 'restore' : 'suspend'}`}
            >
              {target.suspended_at ? 'restore account' : 'suspend account'}
            </a>
            <a className="quiet danger" href={`/admin/users/${target.id}/drop-username`}>drop username</a>
            <a className="quiet danger" href={`/admin/users/${target.id}/delete`}>permanently delete account</a>
          </section>
        )}
    </Layout>
  )
}
