import { isAdminEmail } from '../admin'
import type { User } from '../types'
import type { ProfileRow } from '../types'
import { fmtFull } from '../utils'
import { Layout } from './layout'

type ModeratedUser = ProfileRow & {
  previousUsernames: Array<{ username: string; created_at: string }>
  bannedUsernames: Array<{ username: string; note: string; created_at: string }>
  usernameChanges: Array<{ id: number; changed_at: string }>
  usernameChangesThisMonth: number
}

export function AdminUser({ user, target }: { user: User; target: ModeratedUser }) {
  const protectedAdmin = isAdminEmail(target.email)
  return (
    <Layout user={user} title={`moderate @${target.handle}`}>
      <section className="page-header profile admin-user-header">
        <div className="profile-content">
          <p className="eyebrow">admin moderation</p>
          <h1>@{target.handle}</h1>
          <p><a href={`mailto:${target.email}`}>{target.email}</a></p>
          <p>{target.deleted_at
            ? `Deleted ${fmtFull(target.deleted_at)}`
            : target.suspended_at ? `Suspended ${fmtFull(target.suspended_at)}` : 'Account active'}</p>
        </div>
        {!target.deleted_at && <div className="profile-action">
          <a href={`/u/${target.handle}`}>view profile</a>
        </div>}
      </section>
      {protectedAdmin
        ? <div className="empty relationship-notice">Hardcoded admin accounts are protected from moderation.</div>
        : target.deleted_at
        ? <div className="empty relationship-notice">
          This account is deleted. Only its reserved and banned usernames can be cleared.
        </div>
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
      {!protectedAdmin && !target.deleted_at && (
        <section className="admin-section admin-username-management">
          <h2>username management</h2>
          <form className="admin-username-rename" method="post" action={`/admin/users/${target.id}/username`}>
            <input type="hidden" name="action" value="rename" />
            <label className="form-label">
              username
              <input className="form-control" name="username" required minLength={2} maxLength={24}
                pattern="[a-z0-9_]+"
                defaultValue={target.handle} autoCapitalize="none" spellcheck={false} />
            </label>
            <button className="button" type="submit">save username →</button>
            <span className="form-hint">2–24 lowercase letters, numbers, or underscores. This does not use a slot.</span>
          </form>
          <div className="admin-username-slots">
            <div>
              <strong>{target.usernameChangesThisMonth} of 2 slots used</strong>
              <span>Resets automatically next calendar month.</span>
            </div>
            <form method="post" action={`/admin/users/${target.id}/username`}>
              <input type="hidden" name="action" value="reset-slots" />
              <button className="quiet" type="submit" disabled={!target.usernameChangesThisMonth}>reset slots</button>
            </form>
          </div>
        </section>
      )}
      {!protectedAdmin && (
        <section className="admin-section admin-username-records">
          <h2>{target.deleted_at ? 'reserved username cleanup' : 'username records'}</h2>
          <h3>previous usernames</h3>
          {target.previousUsernames.length
            ? <div className="admin-username-list">{target.previousUsernames.map(entry => (
              <article key={entry.username}>
                <strong>@{entry.username}</strong>
                <time dateTime={entry.created_at}>{fmtFull(entry.created_at)}</time>
                <form method="post" action={`/admin/users/${target.id}/username`}>
                  <input type="hidden" name="action" value="remove-history" />
                  <input type="hidden" name="username" value={entry.username} />
                  <button className="quiet danger" type="submit">remove</button>
                </form>
              </article>
            ))}</div>
            : <p className="section-empty">No previous usernames.</p>}
          <h3>banned usernames</h3>
          {target.bannedUsernames.length
            ? <div className="admin-username-list">{target.bannedUsernames.map(entry => (
              <article key={entry.username}>
                <strong>@{entry.username}</strong>
                <time dateTime={entry.created_at}>{fmtFull(entry.created_at)}</time>
                {entry.note && <p>{entry.note}</p>}
                <form method="post" action={`/admin/users/${target.id}/username`}>
                  <input type="hidden" name="action" value="remove-ban" />
                  <input type="hidden" name="username" value={entry.username} />
                  <button className="quiet danger" type="submit">remove ban</button>
                </form>
              </article>
            ))}</div>
            : <p className="section-empty">No banned usernames.</p>}
          <h3>change events</h3>
          {target.usernameChanges.length
            ? <div className="admin-username-events">{target.usernameChanges.map(change => (
              <time key={change.id} dateTime={change.changed_at}>{fmtFull(change.changed_at)}</time>
            ))}</div>
            : <p className="section-empty">No username changes recorded.</p>}
        </section>
      )}
    </Layout>
  )
}
