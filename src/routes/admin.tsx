import { isAdmin, isAdminEmail } from '../admin'
import {
  AdminConfirm,
  AdminDashboard,
  AdminEmail,
  AdminUser,
} from '../components/pages'
import {
  safeLocalPath,
  safeRefererPath,
} from '../http'
import { currentPage, form, page, paginationRedirect, redirect } from './shared'

import type { Hono } from 'hono'
import { databaseService } from '../database-service'
import { sendAdminEmail, sendReportDecision } from '../email'
import { deleteImagesAfterCommit } from '../image-storage'
import { currentUser } from '../utils'
import { cacheBlockedIp, flushIpRequests } from '../request-ip-blocks'

export function registerAdminRoutes(app: Hono) {
  app.get('/admin/email', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    return page(<AdminEmail user={signedIn} sent={c.req.query('sent') === '1'} />)
  })

  app.post('/admin/email', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/email'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const email = (fields.email || '').trim()
    const title = (fields.title || '').trim()
    const body = (fields.body || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return c.text('Invalid email', 400)
    if (!title || title.length > 200) return c.text('Invalid title', 400)
    if (!body || body.length > 20_000) return c.text('Invalid body', 400)
    await sendAdminEmail(email, title, body)
    return redirect('/admin/email?sent=1')
  })

  app.get('/admin', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const statusValue = c.req.query('status') || 'open'
    if (!['open', 'resolved', 'dismissed'].includes(statusValue)) return c.text('Invalid report status', 400)
    const status = statusValue as 'open' | 'resolved' | 'dismissed'
    const reportPage = currentPage(c.req.query('page'))
    await flushIpRequests()
    const data = await databaseService().call('admin.dashboard', { status, page: reportPage })
    const { stats, total, reports, actions, suspended, illegalReports, ipRequests } = data
    const outOfRange = paginationRedirect(reportPage, total, `/admin?status=${status}`)
    if (outOfRange) return outOfRange
    return page(
      <AdminDashboard user={signedIn} stats={stats} reports={reports} actions={actions} illegalReports={illegalReports}
        status={status} page={reportPage} total={total} suspended={suspended} ipRequests={ipRequests} />,
    )
  })

  app.post('/admin/ip-blocks', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const hash = fields.hash || ''
    const day = new Date().toISOString().slice(0, 10)
    if (!/^[a-f0-9]{64}$/.test(hash)) return c.text('Invalid IP identifier', 400)
    const blocked = await databaseService().call('admin.blockIp', { day, hash, actorId: signedIn.id })
    if (!blocked) return c.text('IP is unavailable or already blocked', 409)
    cacheBlockedIp(day, hash)
    return redirect('/admin')
  })

  app.post('/admin/illegal-reports/:id/:decision', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const decision = c.req.param('decision')
    if (!Number.isInteger(id) || !['resolve', 'dismiss'].includes(decision)) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    const reasons = (f.reasons || '').trim()
    if (reasons.length < 20) return c.text('Specific reasons are required', 400)
    const report = await databaseService().call('admin.decideIllegalReport', {
      id, decision: decision as 'resolve' | 'dismiss', reasons,
    })
    if (report.status === 'not_open') return c.text('Report is not open', 409)
    if (report.reporterEmail) {
      try {
        await sendReportDecision(report.reporterEmail, report.reference,
          decision === 'resolve' ? 'action taken' : 'no action', reasons)
      }
      catch (error) {
        console.error('Could not send report decision', error)
      }
    }
    return redirect('/admin')
  })

  app.post('/admin/reports/:id/:decision', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const decision = c.req.param('decision')
    if (!Number.isInteger(id) || !['resolve', 'dismiss'].includes(decision)) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    const updated = await databaseService().call('admin.decideReport', {
      id, decision: decision as 'resolve' | 'dismiss', actorId: signedIn.id, note: f.note || '',
    })
    if (!updated) return c.text('Report is not open', 409)
    return redirect('/admin')
  })

  app.get('/admin/posts/:id/delete', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) ? await databaseService().call('admin.post', { id }) : null
    if (!post) return c.text('Not found', 404)
    const returnTo = c.req.query('report')
      ? '/admin'
      : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
    return page(<AdminConfirm user={signedIn} kind="delete_post" post={post} returnTo={returnTo} />)
  })

  app.post('/admin/posts/:id/delete', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const f = await form(c.req.raw)
    if (!Number.isInteger(id)) return c.text('Not found', 404)
    const deleted = await databaseService().call('admin.deletePost', { id, actorId: signedIn.id, note: f.note || '' })
    if (deleted.status === 'not_found') return c.text('Not found', 404)
    await deleteImagesAfterCommit(deleted.imageKeys)
    return redirect(safeLocalPath(f.returnTo, '/admin'))
  })

  app.get('/admin/users/:id', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const target = Number.isInteger(id) ? await databaseService().call('admin.user', { id }) : null
    if (!target) return c.text('Not found', 404)
    return page(<AdminUser user={signedIn} target={target} />)
  })

  app.get('/admin/users/:id/:action', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const action = c.req.param('action')
    if (!['suspend', 'restore', 'delete'].includes(action)) return c.text('Not found', 404)
    const target = Number.isInteger(id) ? await databaseService().call('admin.user', { id }) : null
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
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const action = c.req.param('action')
    if (!Number.isInteger(id) || !['suspend', 'restore', 'delete', 'bot'].includes(action)) {
      return c.text('Not found', 404)
    }
    const target = await databaseService().call('admin.user', { id })
    if (!target) return c.text('Not found', 404)
    if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
    if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
    if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
    const f = await form(c.req.raw)
    if (action === 'bot') {
      if (f.bot !== 'yes' && f.bot !== 'no') return c.text('Invalid bot status', 400)
      const isBot = f.bot === 'yes'
      const changed = await databaseService().call('admin.moderateUser', {
        id, actorId: signedIn.id, action: 'bot', isBot, note: f.note || '',
      })
      if (changed.status === 'bot_unchanged') return c.text('Bot status has already changed', 409)
      if (changed.status === 'not_found') return c.text('Not found', 404)
      return redirect(`/admin/users/${id}`)
    }
    const changed = await databaseService().call('admin.moderateUser', {
      id, actorId: signedIn.id, action: action as 'suspend' | 'restore' | 'delete', note: f.note || '',
    })
    if (changed.status === 'not_found') return c.text('Not found', 404)
    if (changed.status === 'already_suspended') return c.text('Account is already suspended', 409)
    if (changed.status === 'not_suspended') return c.text('Account is not suspended', 409)
    if (changed.status !== 'ready') return c.text('Conflict', 409)
    await deleteImagesAfterCommit(changed.imageKeys)
    return redirect(action === 'delete' ? '/admin' : `/admin/users/${id}`)
  })
}
