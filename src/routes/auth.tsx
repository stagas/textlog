import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { Auth, ChooseHandle, MagicLinkSent } from '../components/pages'
import { db } from '../db'
import { sendMagicLink } from '../email'
import { clearSessionCookie, safeLocalPath, sessionCookie } from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { insertSession, sessionHash } from '../sessions'
import { currentUser, hash, token } from '../utils'
import { authLimit, clientAddress, form, page, redirect, retryPage, safeNext } from './shared'

import type { Hono } from 'hono'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const development = () => Bun.env.NODE_ENV === 'development' || Bun.env.DEV_RELOAD === 'true'

function temporaryHandle() {
  return `anon${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

export function registerAuthRoutes(app: Hono) {
  app.get('/enter', c => page(<Auth next={safeNext(c.req.query('next'))} />))
  app.get('/login',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))
  app.get('/signup',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))

  app.post('/enter', async c => {
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    const next = safeNext(f.next)
    const limited = development()
      ? null
      : authLimit(c, 'enter-ip', clientAddress(c), AUTH_LIMITS.loginIp)
        || authLimit(c, 'enter-email', email || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(page(<Auth email={email} next={next} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    if (!emailPattern.test(email) || email.length > 254) {
      return page(<Auth email={email} next={next} error="Enter a valid email address." />, 400)
    }

    const account = db.query(`SELECT id,handle,handle_chosen_at FROM users
      WHERE email=? AND deleted_at IS NULL AND suspended_at IS NULL`).get(email) as { id: number; handle: string;
      handle_chosen_at: string | null } | null
    const value = token()
    db.query('DELETE FROM magic_links WHERE email=? OR expires_at<=?').run(email, Date.now())
    db.query(`INSERT INTO magic_links(token_hash,email,user_id,next_path,expires_at,created_at)
      VALUES(?,?,?,?,?,?)`).run(hash(value), email, account?.id ?? null, next, Date.now() + 3600000, Date.now())
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const magicUrl = `${origin}/enter/magic?token=${encodeURIComponent(value)}`
    if (!development()) {
      try {
        await sendMagicLink(email, magicUrl, account?.handle_chosen_at ? account.handle : undefined)
      }
      catch (error) {
        console.error('Could not send magic link', error)
        db.query('DELETE FROM magic_links WHERE token_hash=?').run(hash(value))
        return page(
          <Auth email={email} next={next} error="The magic link could not be sent. Please try again later." />,
          503,
        )
      }
    }
    return page(<MagicLinkSent email={email} magicUrl={development() ? magicUrl : undefined} />)
  })

  app.get('/enter/magic', c => {
    const value = c.req.query('token') || ''
    const link = value && db.query(`SELECT token_hash,email,user_id,next_path FROM magic_links
      WHERE token_hash=? AND expires_at>?`).get(hash(value), Date.now()) as { token_hash: string; email: string;
      user_id: number | null; next_path: string } | null
    if (!link) return page(<Auth error="That magic link is invalid or has expired. Request a new one." />, 400)

    const newAccount = !link.user_id
    let userId = link.user_id
    let chosen = true
    const session = token()
    try {
      db.transaction(() => {
        db.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
        if (userId) {
          const account = db.query('SELECT handle_chosen_at FROM users WHERE id=?').get(userId) as {
            handle_chosen_at: string | null
          } | null
          if (!account) throw new Error('Account is unavailable')
          chosen = Boolean(account.handle_chosen_at)
          db.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP) WHERE id=?')
            .run(userId)
        }
        else {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const created = db.query(`INSERT INTO users(handle,email,password,email_verified_at)
                VALUES(?,?,'!',CURRENT_TIMESTAMP) RETURNING id`).get(temporaryHandle(), link.email) as { id: number }
              userId = created.id
              chosen = false
              break
            }
            catch (error) {
              if (db.query('SELECT id FROM users WHERE email=?').get(link.email)) throw error
            }
          }
          if (!userId) throw new Error('Could not allocate temporary handle')
        }
        insertSession(db, session, userId!, Date.now() + 2592000000, Date.now(), c.req.header('user-agent') || '')
      })()
    }
    catch {
      return page(<Auth error="That account is unavailable. Request a new magic link." />, 400)
    }
    const nextPath = newAccount && link.next_path === '/' ? '/explore?welcome=1' : safeLocalPath(link.next_path)
    const destination = chosen ? nextPath : `/choose-handle?next=${encodeURIComponent(nextPath)}`
    return redirect(destination, sessionCookie(session))
  })

  app.get('/choose-handle', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent(c.req.path))
    if (user.handle_chosen_at) return redirect(safeNext(c.req.query('next')))
    return page(<ChooseHandle next={safeNext(c.req.query('next'))} />)
  })

  app.post('/choose-handle', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    if (user.handle_chosen_at) return redirect('/')
    const f = await form(c.req.raw)
    const handle = (f.handle || '').trim().toLowerCase().replace(/^@/, '')
    const next = safeNext(f.next)
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) {
      return page(<ChooseHandle handle={handle} next={next} error="Use 2–24 letters, numbers, or underscores." />, 400)
    }
    const moderation = await moderateText(`handle: ${handle}`)
    if (!moderation.ok) {
      return page(<ChooseHandle handle={handle} next={next} error={moderation.reason === 'flagged'
        ? 'That handle may violate our content rules. Please choose another.'
        : moderationMessage(moderation.reason)} />, moderation.reason === 'flagged' ? 422 : 503)
    }
    try {
      db.transaction(() => {
        if (db.query('SELECT 1 FROM users WHERE handle=? COLLATE NOCASE AND id!=?').get(handle, user.id)
          || db.query('SELECT 1 FROM handle_history WHERE handle=? COLLATE NOCASE').get(handle)) throw new Error()
        db.query('UPDATE users SET handle=?,handle_chosen_at=CURRENT_TIMESTAMP WHERE id=?').run(handle, user.id)
      })()
    }
    catch {
      return page(<ChooseHandle handle={handle} next={next} error="That handle is unavailable." />, 400)
    }
    return redirect(next)
  })

  app.post('/logout', c => {
    const session = c.req.header('cookie')?.match(/root=([^;]+)/)?.[1]
    if (session) db.query('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(session))
    return redirect('/', clearSessionCookie())
  })
}
