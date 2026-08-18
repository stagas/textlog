import type { Hono } from 'hono'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { IllegalActivityReport } from '../components/pages'
import { databaseService } from '../database-service'
import { sendReportReceipt } from '../email'
import { ILLEGAL_REPORT_BODY_LIMIT } from '../http'
import { currentUser, token } from '../utils'
import { form, page } from './shared'
import { authLimit, clientAddress, retryPage } from './shared'

const categories = new Set(['hate', 'privacy', 'copyright', 'fraud', 'child_safety', 'other'])

export function registerIllegalActivityRoutes(app: Hono) {
  app.get('/report-illegal-activity',
    c =>
      page(<IllegalActivityReport user={currentUser(c.req.raw)} values={{ contentUrl: c.req.query('url') || '' }} />))

  app.post('/report-illegal-activity', async c => {
    const user = currentUser(c.req.raw)
    const values = await form(c.req.raw, ILLEGAL_REPORT_BODY_LIMIT)
    const limited = await authLimit(c, 'illegal-report-ip', clientAddress(c), AUTH_LIMITS.illegalReportIp)
    if (limited) {
      return retryPage(
        page(<IllegalActivityReport user={user} values={values} error={authRateLimitMessage(limited.retryAfter)} />,
          429),
        limited.retryAfter,
      )
    }
    const email = (values.email || '').trim().toLowerCase()
    const name = (values.name || '').trim()
    const category = values.category || ''
    let contentUrl: URL | null = null
    try {
      contentUrl = new URL(values.contentUrl || '')
    }
    catch {}
    const origin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : new URL(c.req.url).origin
    const match = contentUrl?.origin === origin ? contentUrl.pathname.match(/^\/post\/(\d+)$/) : null
    const postId = match ? Number(match[1]) : 0
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    const identityRequired = category !== 'child_safety'
    if (!postId || !categories.has(category) || (values.details || '').trim().length < 20 || values.goodFaith !== 'yes'
      || (identityRequired && (!name || !validEmail)) || (email && !validEmail))
    {
      return page(
        <IllegalActivityReport user={user} values={values}
          error="Provide the post, category, details, required contact information, and good-faith confirmation." />,
        400,
      )
    }
    const reference = `RPT-${token().slice(0, 12).toUpperCase()}`
    const created = await databaseService().call('reports.createIllegalActivity', {
      postId, contentUrl: contentUrl!.href, details: values.details.trim(), reporterEmail: email || null,
      reference, category, reporterName: name || null,
    })
    if (!created) {
      return page(
        <IllegalActivityReport user={user} values={values}
          error="Provide the post, category, details, required contact information, and good-faith confirmation." />,
        400,
      )
    }
    if (email) {
      try {
        await sendReportReceipt(email, reference)
      }
      catch (error) {
        console.error('Could not send report receipt', error)
      }
    }
    return page(<IllegalActivityReport user={user} reference={reference} />, 201)
  })
}
