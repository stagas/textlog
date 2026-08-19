import type { User } from '../types'
import { PAGE_SIZE } from '../pagination'
import type { AdminActionView, AdminReportView, DashboardStats, IllegalActivityReportView, ProfileRow } from '../types'
import { fmtFull } from '../utils'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { maskEmail } from './email-address'
import { Pagination } from './page-shared'
import { StatsGrid } from './stats'

export function AdminDashboard(
  { user, stats, reports, actions, illegalReports = [], status, page, total, suspended = [], ipRequests = [] }: {
    user: User
    stats: DashboardStats
    reports: AdminReportView[]
    actions: AdminActionView[]
    illegalReports?: IllegalActivityReportView[]
    status: 'open' | 'resolved' | 'dismissed'
    page: number
    total: number
    suspended?: ProfileRow[]
    ipRequests?: Array<{ hash: string; obfuscated: string; requests: number; blocked: boolean }>
  },
) {
  return (
    <Layout user={user} title="admin">
      <PageHeading
        className="admin-header"
        eyebrow="operations"
        title="admin dashboard"
        action={<a className="profile-edit-link" href="/admin/email">send email</a>}
      />
      <StatsGrid stats={stats} />
      <section className="admin-section admin-ip-requests">
        <h2>top IPs today <span>{ipRequests.length}</span></h2>
        {ipRequests.length
          ? (
            <div className="admin-ip-list">
              {ipRequests.map(ip => (
                <article key={ip.hash}>
                  <code>{ip.obfuscated}</code>
                  <div className="admin-ip-actions">
                    <span>{ip.requests.toLocaleString()} requests</span>
                    {ip.blocked
                      ? <span className="danger">blocked today</span>
                      : (
                        <form method="post" action="/admin/ip-blocks">
                          <input type="hidden" name="hash" value={ip.hash} />
                          <button className="quiet danger">block</button>
                        </form>
                      )}
                  </div>
                </article>
              ))}
            </div>
          )
          : <p className="section-empty">No requests recorded today.</p>}
      </section>
      <section className="admin-section">
        <h2>
          illegal activity reports <span>{illegalReports.length}</span>
        </h2>
        {illegalReports.length
          ? (
            <div className="report-list">
              {illegalReports.map(report => (
                <article className="admin-report" key={report.id}>
                  <div className="admin-report-meta">
                    <span>{report.reference} · {report.category} · post #{report.post_id}</span>
                    <span>{report.reporter_name || 'identity exception'} · {
                      report.reporter_email ? maskEmail(report.reporter_email) : 'no email'
                    }</span>
                  </div>
                  <p>{report.details}</p>
                  <a href={report.content_url}>view post</a>
                  <div className="admin-inline-actions">
                    {(['resolve', 'dismiss'] as const).map(decision => (
                      <form method="post" action={`/admin/illegal-reports/${report.id}/${decision}`} key={decision}>
                        <input name="reasons" minLength={20} maxLength={2000} required placeholder="specific reasons"
                          autoComplete="off" inputMode="text" enterKeyHint="done" />
                        <button className="quiet">{decision}</button>
                      </form>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )
          : <p className="section-empty">No open illegal activity reports.</p>}
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
                          placeholder="optional note" autoComplete="off" inputMode="text" enterKeyHint="done" />
                        <button className="quiet">resolve</button>
                      </form>
                      <form method="post" action={`/admin/reports/${report.id}/dismiss`}>
                        <input name="note" maxLength={500} aria-label="Optional dismissal note"
                          placeholder="optional note" autoComplete="off" inputMode="text" enterKeyHint="done" />
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
        <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path={`/admin?status=${status}`} />
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
