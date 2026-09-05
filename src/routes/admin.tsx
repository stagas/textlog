import { isAdmin, isAdminEmail } from '../admin'
import {
  AdminConfirm,
  AdminDashboard,
  AdminEmail,
  AdminPostModeration,
  AdminPush,
  AdminTags,
  AdminTranslate,
  AdminUser,
} from '../components/pages'
import {
  safeLocalPath,
  safeRefererPath,
} from '../http'
import { currentPage, form, page, paginationRedirect, redirect } from './shared'

import type { Hono } from 'hono'
import { LogsPage } from '../components/logs'
import { isValidHashtag, normalizeHashtag, normalizeHashtagSpelling } from '../content'
import { databaseService } from '../database-service'
import { sendAdminEmail, sendReportDecision } from '../email'
import { deleteImagesAfterCommit } from '../image-storage'
import { openLogStream, registerLogConnectionCloser } from '../log-stream'
import { sendPushToAll, sendPushToUser } from '../push'
import { cacheBlockedIp, flushIpRequests } from '../request-ip-blocks'
import { isTranslationLanguage, translateText } from '../translation'
import { currentUser } from '../utils'

export function registerAdminRoutes(app: Hono) {
  app.get('/admin/logs', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    return page(<LogsPage user={signedIn} />)
  })

  app.get('/admin/logs/events', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn || !isAdmin(signedIn)) return c.text('Forbidden', 403)

    const encoder = new TextEncoder()
    let close: (() => void) | undefined
    let unregisterCloser: (() => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const cleanup = () => {
          close?.()
          close = undefined
          unregisterCloser?.()
          unregisterCloser = undefined
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = undefined
        }
        const closeConnection = () => {
          if (closed) return
          closed = true
          cleanup()
          try {
            controller.close()
          }
          catch {}
        }
        const send = (entry: { id: number; text: string }) =>
          controller.enqueue(encoder.encode(
            `id: ${entry.id}\ndata: ${JSON.stringify(entry.text)}\n\n`,
          ))
        const lastEventId = Number(c.req.header('last-event-id'))
        const stream = openLogStream(send, Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0)
        close = stream.close
        unregisterCloser = registerLogConnectionCloser(closeConnection)
        controller.enqueue(encoder.encode('event: ready\ndata: connected\n\n'))
        for (const entry of stream.history) send(entry)
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), 15_000)
        c.req.raw.signal.addEventListener('abort', closeConnection, { once: true })
      },
      cancel() {
        close?.()
        unregisterCloser?.()
        if (heartbeat) clearInterval(heartbeat)
      },
    })
    return new Response(body, { headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    } })
  })

  app.get('/admin/tags', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const [groups, displayNames, invariants] = await Promise.all([
      databaseService().call('admin.tagAliases', {}),
      databaseService().call('admin.tagDisplayNames', {}),
      databaseService().call('admin.tagInvariants', {}),
    ])
    return page(
      <AdminTags user={signedIn} groups={groups} displayNames={displayNames} invariants={invariants}
        error={c.req.query('error')} />,
    )
  })

  app.post('/admin/tags/invariants', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const tag = normalizeHashtagSpelling((fields.tag || '').replace(/^#/, '').trim())
    if (!isValidHashtag(tag)) return c.text('Invalid invariant tag', 400)
    await databaseService().call('admin.addTagInvariant', { tag })
    return redirect('/admin/tags')
  })

  app.post('/admin/tags/invariants/:tag/remove', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const tag = normalizeHashtagSpelling(c.req.param('tag'))
    if (!isValidHashtag(tag)) return c.text('Invalid invariant tag', 400)
    await databaseService().call('admin.removeTagInvariant', { tag })
    return redirect('/admin/tags')
  })

  app.post('/admin/tags', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const primaryTag = normalizeHashtag((fields.primary || '').replace(/^#/, '').trim())
    const aliases = [...new Set((fields.aliases || '').split(/[\s,]+/)
      .map(value => normalizeHashtag(value.replace(/^#/, '').trim())).filter(value => value && value !== primaryTag))]
    if (!isValidHashtag(primaryTag) || !aliases.length || aliases.some(alias => !isValidHashtag(alias))) {
      return c.text('Invalid primary tag or aliases', 400)
    }
    const result = await databaseService().call('admin.addTagAliases', { primaryTag, aliases })
    if (result.status === 'conflict') return redirect(`/admin/tags?error=${encodeURIComponent(result.tag)}`)
    return redirect('/admin/tags')
  })

  app.post('/admin/tags/:alias/remove', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const alias = normalizeHashtag(c.req.param('alias'))
    if (!isValidHashtag(alias)) return c.text('Invalid alias', 400)
    await databaseService().call('admin.removeTagAlias', { alias })
    return redirect('/admin/tags')
  })

  app.post('/admin/tags/display-name', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const tag = normalizeHashtag((fields.tag || '').replace(/^#/, '').trim())
    const displayName = (fields.displayName || '').replace(/^#/, '').trim().normalize('NFC')
    if (!isValidHashtag(tag) || !/^[\p{L}\p{M}\p{N}_]{1,280}$/u.test(displayName)
      || normalizeHashtag(displayName) !== tag) return c.text('Invalid tag display name', 400)
    await databaseService().call('admin.setTagDisplayName', { tag, displayName })
    return redirect('/admin/tags')
  })

  app.post('/admin/tags/:tag/display-name/remove', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/tags'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const tag = normalizeHashtag(c.req.param('tag'))
    if (!isValidHashtag(tag)) return c.text('Invalid tag', 400)
    await databaseService().call('admin.removeTagDisplayName', { tag })
    return redirect('/admin/tags')
  })

  app.get('/admin/push', c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const sent = c.req.query('sent')
    return page(<AdminPush user={signedIn} sent={sent === 'test' || sent === 'all' ? sent : undefined} />)
  })

  app.post('/admin/push', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin/push'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const fields = await form(c.req.raw)
    const title = (fields.title || '').trim()
    const body = (fields.body || '').trim()
    const url = (fields.url || '').trim()
    const audience = fields.audience
    if (!title || title.length > 200) return c.text('Invalid title', 400)
    if (!body || body.length > 2_000) return c.text('Invalid body', 400)
    let validUrl = /^\/(?!\/)/.test(url)
    if (!validUrl) {
      try {
        const parsed = new URL(url)
        validUrl = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      }
      catch {}
    }
    if (!validUrl || url.length > 2_048) return c.text('Invalid destination URL', 400)
    if (audience === 'test') {
      await sendPushToUser(signedIn.id, { title, body, url }, undefined, undefined, true)
      return page(<AdminPush user={signedIn} sent="test" values={{ title, body, url }} />)
    }
    else if (audience === 'all') await sendPushToAll({ title, body, url })
    else return c.text('Invalid audience', 400)
    return redirect(`/admin/push?sent=${audience}`)
  })

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
    const from = (fields.from || '').trim()
    const email = (fields.email || '').trim()
    const title = (fields.title || '').trim()
    const body = (fields.body || '').trim()
    if (!/^(?:[^<>\r\n]+\s*)?<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$|^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
      || from.length > 320) return c.text('Invalid from email', 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return c.text('Invalid email', 400)
    if (!title || title.length > 200) return c.text('Invalid title', 400)
    if (!body || body.length > 20_000) return c.text('Invalid body', 400)
    await sendAdminEmail(email, title, body, from)
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
    const { stats, total, reports, actions, suspended, illegalReports, ipRequests, bannedUsernames } = data
    const outOfRange = paginationRedirect(reportPage, total, `/admin?status=${status}`)
    if (outOfRange) return outOfRange
    return page(
      <AdminDashboard user={signedIn} stats={stats} reports={reports} actions={actions} illegalReports={illegalReports}
        status={status} page={reportPage} total={total} suspended={suspended} ipRequests={ipRequests}
        bannedUsernames={bannedUsernames} />,
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
      id,
      decision: decision as 'resolve' | 'dismiss',
      reasons,
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
      id,
      decision: decision as 'resolve' | 'dismiss',
      actorId: signedIn.id,
      note: f.note || '',
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
    const returnTo = c.req.query('from')
      ? safeLocalPath(c.req.query('from'), c.req.url, `/post/${id}`)
      : c.req.query('report')
      ? '/admin'
      : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
    return page(<AdminConfirm user={signedIn} kind="delete_post" post={post} returnTo={returnTo} />)
  })

  app.get('/admin/posts/:id/moderate', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) ? await databaseService().call('admin.post', { id }) : null
    if (!post) return c.text('Not found', 404)
    const returnTo = c.req.query('from')
      ? safeLocalPath(c.req.query('from'), c.req.url, `/post/${id}`)
      : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
    return page(<AdminPostModeration user={signedIn} post={post} returnTo={returnTo} />)
  })

  app.post('/admin/posts/:id/moderate', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    const action = f.action || ''
    const category = action === 'mark' ? (f.category || '').trim() : null
    if (!['mark', 'unmark'].includes(action) || action === 'mark' && (!category || category.length > 100)) {
      return c.text('Invalid moderation action', 400)
    }
    const changed = await databaseService().call('admin.moderatePost', { id, actorId: signedIn.id, category })
    if (changed.status === 'not_found') return c.text('Not found', 404)
    const returnTo = safeLocalPath(f.returnTo, c.req.url, `/post/${id}`)
    return redirect(`/admin/posts/${id}/moderate?from=${encodeURIComponent(returnTo)}`)
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

  app.get('/admin/posts/:id/translate', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) ? await databaseService().call('admin.post', { id }) : null
    if (!post) return c.text('Not found', 404)
    const requestedReturnTo = c.req.query('from')
    const returnTo = requestedReturnTo
      ? safeLocalPath(requestedReturnTo, c.req.url, `/post/${id}`)
      : safeRefererPath(c.req.header('referer'), c.req.url, `/post/${id}`)
    return page(<AdminTranslate user={signedIn} post={post} returnTo={returnTo} />)
  })

  app.post('/admin/posts/:id/translate', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const post = Number.isInteger(id) ? await databaseService().call('admin.post', { id }) : null
    if (!post) return c.text('Not found', 404)
    const f = await form(c.req.raw)
    const source = f.source || ''
    if (!isTranslationLanguage(source)) return c.text('Invalid source language', 400)
    try {
      const translation = await translateText(post.body, 'en', undefined, source)
      const saved = await databaseService().call('admin.translatePost', { id, translation: translation.text })
      if (saved.status === 'not_found') return c.text('Not found', 404)
      return redirect(safeLocalPath(f.returnTo, c.req.url, `/post/${id}`))
    }
    catch (error) {
      console.error(`Could not translate post ${id}`, error)
      return c.text('Could not translate post', 502)
    }
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
    if (!['suspend', 'restore', 'delete', 'drop-username'].includes(action)) return c.text('Not found', 404)
    const target = Number.isInteger(id) ? await databaseService().call('admin.user', { id }) : null
    if (!target) return c.text('Not found', 404)
    if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
    if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
    if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
    return page(
      <AdminConfirm user={signedIn} target={target} kind={action === 'suspend' ? 'suspend_user' : action === 'restore'
        ? 'restore_user'
        : action === 'drop-username'
        ? 'drop_username'
        : 'delete_user'} returnTo={`/admin/users/${id}`} />,
    )
  })

  app.post('/admin/users/:id/:action', async c => {
    const signedIn = currentUser(c.req.raw)
    if (!signedIn) return redirect('/enter?next=' + encodeURIComponent('/admin'))
    if (!isAdmin(signedIn)) return c.text('Forbidden', 403)
    const id = Number(c.req.param('id'))
    const action = c.req.param('action')
    if (!Number.isInteger(id) || !['suspend', 'restore', 'delete', 'drop-username'].includes(action)) {
      return c.text('Not found', 404)
    }
    const target = await databaseService().call('admin.user', { id })
    if (!target) return c.text('Not found', 404)
    if (target.id === signedIn.id || isAdminEmail(target.email)) return c.text('Protected admin account', 403)
    if (action === 'suspend' && target.suspended_at) return c.text('Account is already suspended', 409)
    if (action === 'restore' && !target.suspended_at) return c.text('Account is not suspended', 409)
    const f = await form(c.req.raw)
    const changed = await databaseService().call('admin.moderateUser', {
      id,
      actorId: signedIn.id,
      action: action as 'suspend' | 'restore' | 'delete' | 'drop-username',
      note: f.note || '',
    })
    if (changed.status === 'not_found') return c.text('Not found', 404)
    if (changed.status === 'already_suspended') return c.text('Account is already suspended', 409)
    if (changed.status === 'not_suspended') return c.text('Account is not suspended', 409)
    if (changed.status !== 'ready') return c.text('Conflict', 409)
    await deleteImagesAfterCommit(changed.imageKeys)
    return redirect(action === 'delete' ? '/admin' : `/admin/users/${id}`)
  })
}
