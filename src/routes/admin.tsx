import { anonymizeUser, isAdmin, isAdminEmail, recordAdminAction, resolvePostReports, softDeletePost } from '../admin'
import {
  AdminConfirm,
  AdminDashboard,
  AdminUser,
} from '../components/pages'
import {
  safeLocalPath,
  safeRefererPath,
} from '../http'
import type { AdminActionView, AdminReportView, DashboardStats, PostRow, ProfileRow } from '../types'
import { adminUser, currentPage, form, page, paginationRedirect, redirect } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { currentUser } from '../utils'
import { visitorStats } from '../visitors'

export function registerAdminRoutes(app: Hono) {
  app.get('/admin', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const statusValue = c.req.query('status') || 'open'
    if (!['open', 'resolved', 'dismissed'].includes(statusValue)) return c.text('Invalid report status', 400)
    const status = statusValue as 'open' | 'resolved' | 'dismissed'
    const reportPage = currentPage(c.req.query('page'))
    const stats = db.query(`SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL) users,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND suspended_at IS NOT NULL) suspendedUsers,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL) activePosts,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND parent_id IS NOT NULL) replies,
    (SELECT count(*) FROM reports WHERE status='open') openReports,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) users24h,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) users7d,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-1 day')) posts24h,
    (SELECT count(*) FROM posts WHERE deleted_at IS NULL AND created_at>=datetime('now','-7 days')) posts7d`) as any
    const dashboardStats = { ...(stats.get() as Omit<DashboardStats, 'visitorsToday' | 'visitors7d'>),
      ...visitorStats(db) }
    const total = (db.query('SELECT count(*) count FROM reports WHERE status=?').get(status) as { count: number }).count
    const outOfRange = paginationRedirect(reportPage, total, `/admin?status=${status}`)
    if (outOfRange) return outOfRange
    const reports = db.query(`SELECT r.id,r.reason,r.status,r.created_at,r.resolved_at,r.post_id,
    p.body post_body,p.deleted_at post_deleted_at,p.user_id author_id,author.handle author_handle,
    reporter.handle reporter_handle,resolver.handle resolver_handle
    FROM reports r JOIN posts p ON p.id=r.post_id JOIN users author ON author.id=p.user_id
    JOIN users reporter ON reporter.id=r.reporter_id LEFT JOIN users resolver ON resolver.id=r.resolved_by
    WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`)
      .all(status, (reportPage - 1) * 20) as AdminReportView[]
    const actions = db.query(`SELECT aa.id,aa.action,aa.note,aa.created_at,actor.handle actor_handle,
    aa.target_user_id,target.handle target_handle,aa.target_post_id
    FROM admin_actions aa JOIN users actor ON actor.id=aa.actor_id
    LEFT JOIN users target ON target.id=aa.target_user_id ORDER BY aa.created_at DESC,aa.id DESC LIMIT 20`)
      .all() as AdminActionView[]
    const suspended = db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE deleted_at IS NULL AND suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 20`).all() as ProfileRow[]
    return page(
      <AdminDashboard user={signedIn} stats={dashboardStats} reports={reports} actions={actions} status={status}
        page={reportPage} total={total} suspended={suspended} />,
    )
  })

  app.post('/admin/reports/:id/:decision', async c => {
    const user = adminUser(c.req.raw)
    if (!currentUser(c.req.raw)) return redirect('/login?next=' + encodeURIComponent('/admin'))
    if (!user) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const decision = c.req.param('decision')
    if (!Number.isInteger(id) || !['resolve', 'dismiss'].includes(decision)) return c.text('Not found', 404)
    const report = db.query('SELECT post_id FROM reports WHERE id=? AND status=\'open\'').get(id) as
      | { post_id: number }
      | null
    if (!report) return c.text('Report is not open', 409)
    const f = await form(c.req.raw)
    db.transaction(() => {
      db.query(`UPDATE reports SET status=?,resolved_at=CURRENT_TIMESTAMP,resolved_by=? WHERE id=? AND status='open'`)
        .run(decision === 'resolve' ? 'resolved' : 'dismissed', user.id, id)
      recordAdminAction(db, user.id, decision === 'resolve' ? 'resolve_report' : 'dismiss_report', null, report.post_id,
        f.note || '')
    })()
    return redirect('/admin')
  })

  app.get('/admin/posts/:id/delete', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,
    u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL`).get(id) as
        | (PostRow & { handle: string })
        | null
      : null
    if (!post) return c.text('Not found', 404)
    const returnTo = c.req.query('report')
      ? '/admin'
      : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
    return page(<AdminConfirm user={signedIn} kind="delete_post" post={post} returnTo={returnTo} />)
  })

  app.post('/admin/posts/:id/delete', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id)
      ? db.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as { user_id: number } | null
      : null
    if (!post) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    db.transaction(() => {
      softDeletePost(db, id)
      resolvePostReports(db, id, signedIn.id)
      recordAdminAction(db, signedIn.id, 'delete_post', post.user_id, id, f.note || '')
    })()
    return redirect(safeLocalPath(f.returnTo, '/admin'))
  })

  app.get('/admin/users/:id', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const target = Number.isInteger(id)
      ? db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE id=? AND deleted_at IS NULL`).get(id) as ProfileRow | null
      : null
    if (!target) return c.text('Not found', 404)
    return page(<AdminUser user={signedIn} target={target} />)
  })

  app.get('/admin/users/:id/:action', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const action = c.req.param('action')
    if (!['suspend', 'restore', 'delete'].includes(action)) return c.text('Not found', 404)
    const target = Number.isInteger(id)
      ? db.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
    WHERE id=? AND deleted_at IS NULL`).get(id) as ProfileRow | null
      : null
    if (!target) return c.text('Not found', 404)
    if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
    if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
    if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
    return page(
      <AdminConfirm user={signedIn} target={target}
        kind={action === 'suspend' ? 'suspend_user' : action === 'restore' ? 'restore_user' : 'delete_user'}
        returnTo={`/admin/users/${id}`} />,
    )
  })

  app.post('/admin/users/:id/:action', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/login?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const action = c.req.param('action')
    if (!Number.isInteger(id) || !['suspend', 'restore', 'delete'].includes(action)) return c.text('Not found', 404)
    const target = db.query('SELECT id,email,suspended_at FROM users WHERE id=? AND deleted_at IS NULL').get(id) as {
      id: number
      email: string
      suspended_at: string | null
    } | null
    if (!target) return c.text('Not found', 404)
    if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
    if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
    if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
    const f = await form(c.req.raw)
    db.transaction(() => {
      if (action === 'suspend') {
        db.query('UPDATE users SET suspended_at=CURRENT_TIMESTAMP WHERE id=?').run(id)
        db.query('DELETE FROM sessions WHERE user_id=?').run(id)
        recordAdminAction(db, signedIn.id, 'suspend_user', id, null, f.note || '')
      }
      else if (action === 'restore') {
        db.query('UPDATE users SET suspended_at=NULL WHERE id=?').run(id)
        recordAdminAction(db, signedIn.id, 'restore_user', id, null, f.note || '')
      }
      else {
        recordAdminAction(db, signedIn.id, 'delete_user', id, null, f.note || '')
        anonymizeUser(db, id, signedIn.id)
      }
    })()
    return redirect(action === 'delete' ? '/admin' : `/admin/users/${id}`)
  })
}
