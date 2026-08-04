import type { Hono } from 'hono'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { IllegalActivityReport } from '../components/pages'
import { db } from '../db'
import { sendReportReceipt } from '../email'
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
    const values = await form(c.req.raw)
    const limited = authLimit(c, 'illegal-report-ip', clientAddress(c), AUTH_LIMITS.illegalReportIp)
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
    if (!postId || !db.query('SELECT 1 FROM posts WHERE id=?').get(postId)
      || !categories.has(category) || (values.details || '').trim().length < 20 || values.goodFaith !== 'yes'
      || (identityRequired && (!name || !validEmail)) || (email && !validEmail))
    {
      return page(
        <IllegalActivityReport user={user} values={values}
          error="Provide the post, category, details, required contact information, and good-faith confirmation." />,
        400,
      )
    }
    const reference = `RPT-${token().slice(0, 12).toUpperCase()}`
    db.query(`INSERT INTO illegal_activity_reports(post_id,content_url,details,reporter_email,reference,category,
      reporter_name,good_faith) VALUES(?,?,?,?,?,?,?,1)`).run(postId, contentUrl!.href, values.details.trim(),
      email || null, reference, category, name || null)
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
