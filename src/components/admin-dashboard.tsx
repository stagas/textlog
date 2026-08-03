import { type User } from '../db'
import type { AdminActionView, AdminReportView, DashboardStats, ProfileRow } from '../types'
import { fmtFull } from '../utils'
import { Layout } from './layout'
import { pageSize, Pagination } from './page-shared'

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
