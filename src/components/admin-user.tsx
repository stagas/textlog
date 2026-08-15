import { isAdminEmail } from '../admin'
import { type User } from '../db'
import { maskEmail } from './email-address'
import type { ProfileRow } from '../types'
import { fmtFull } from '../utils'
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
          <p>{target.bot_managed ? 'Bot status enforced by moderation' : target.is_bot ? 'Self-declared bot' : 'Not a bot'}</p>
        </div>
        <div className="profile-action">
          <a href={`/u/${target.handle}`}>view profile</a>
        </div>
      </section>
      {protectedAdmin
        ? <div className="empty relationship-notice">Hardcoded admin accounts are protected from moderation.</div>
        : (
          <section className="admin-user-actions">
            <form method="post" action={`/admin/users/${target.id}/bot`}>
              <button className="button" name="bot" value={!target.bot_managed || !target.is_bot ? 'yes' : 'no'}>
                {!target.bot_managed && target.is_bot
                  ? 'take permanent control of bot status'
                  : target.is_bot
                  ? 'moderator: mark as not bot'
                  : 'permanently mark as bot'}
              </button>
            </form>
            <a className={`button ${target.suspended_at ? '' : 'button-danger'}`}
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
