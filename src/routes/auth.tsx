import { AUTH_LIMITS, authRateLimitMessage, loginSubnet } from '../auth-rate-limit'
import { sessionCookieName } from '../brand'
import { Auth, ChooseHandle, ForgotPassword, MagicLinkSent, PasswordLogin, ResetPassword } from '../components/pages'
import { db } from '../db'
import { sendMagicLink, sendPasswordReset } from '../email'
import { isDevelopment } from '../environment'
import { clearSessionCookie, safeLocalPath, sessionCookie } from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { consumePasswordLoginNonce, issuePasswordLoginNonce } from '../password-login-nonce'
import { consumePasswordCaptcha, issuePasswordCaptcha, passwordCaptchaRequired, recordFailedPassword }
  from '../password-login-captcha'
import { insertSession, SESSION_LIFETIME_MS, sessionHash } from '../sessions'
import { currentUser, hash, hashPassword, token, verifyPassword } from '../utils'
import { sendPushForSignup } from '../push'
import { logError } from '../log'
import { authLimit, clientAddress, form, issueMagicLink, page, redirect, retryPage, safeNext } from './shared'

import type { Hono } from 'hono'

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const dummyPasswordHash = hashPassword(crypto.randomUUID())
function temporaryHandle() {
  return `anon${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

type MagicLink = { token_hash: string; email: string; user_id: number | null; next_path: string }

function completeMagicEntry(link: MagicLink, userAgent: string) {
  const newAccount = !link.user_id
  let userId = link.user_id
  let chosen = true
  const session = token()
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
    insertSession(db, session, userId!, Date.now() + SESSION_LIFETIME_MS, Date.now(), userAgent)
  })()
  const nextPath = newAccount && link.next_path === '/' ? '/explore?welcome=1' : safeLocalPath(link.next_path)
  return { session, destination: chosen ? nextPath : `/choose-handle?next=${encodeURIComponent(nextPath)}` }
}

export function registerAuthRoutes(app: Hono) {
  app.get('/enter', c => page(<Auth next={safeNext(c.req.query('next'))} />))
  app.get('/login',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))
  app.get('/signup',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))

  app.get('/enter/password', c => {
    const captcha = passwordCaptchaRequired(db) ? issuePasswordCaptcha(db) : undefined
    return page(<PasswordLogin nonce={issuePasswordLoginNonce(db, clientAddress(c))} captcha={captcha}
      next={safeNext(c.req.query('next'))} reset={c.req.query('reset') === '1'} />)
  })
  app.post('/enter/password', async c => {
    const f = await form(c.req.raw)
    const identifier = (f.identifier || '').trim().toLowerCase().replace(/^@/, '')
    const password = f.password || ''
    const next = safeNext(f.next)
    const address = clientAddress(c)
    const loginCaptcha = () => passwordCaptchaRequired(db) ? issuePasswordCaptcha(db) : undefined
    if (!consumePasswordLoginNonce(db, f.nonce || '', address)) {
      return page(<PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
        captcha={loginCaptcha()}
        error="This login form has expired or was already used. Please try again." />, 400)
    }
    if (passwordCaptchaRequired(db)
      && !consumePasswordCaptcha(db, f.captchaToken || '', f.captchaAnswer || '')) {
      return page(<PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
        captcha={issuePasswordCaptcha(db)} error="Complete the security check and try again." />, 400)
    }
    const limited = authLimit(c, 'password-login-ip', address, AUTH_LIMITS.loginIp)
      || authLimit(c, 'password-login-subnet', loginSubnet(address), AUTH_LIMITS.loginSubnet)
      || authLimit(c, 'password-login-account', identifier || '(blank)', AUTH_LIMITS.loginAccount)
    if (limited) {
      return retryPage(
        page(<PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
          captcha={loginCaptcha()}
          error={authRateLimitMessage(limited.retryAfter)} />,
          429),
        limited.retryAfter,
      )
    }
    const account = db.query(`SELECT id,password FROM users WHERE (email=? OR handle=? COLLATE NOCASE)
      AND deleted_at IS NULL AND suspended_at IS NULL`).get(identifier, identifier) as
      | { id: number; password: string }
      | null
    const valid = await verifyPassword(password, account?.password !== '!' && account?.password
      ? account.password
      : await dummyPasswordHash)
    if (!account || account.password === '!' || !valid) {
      recordFailedPassword(db)
      return page(
        <PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
          captcha={loginCaptcha()}
          error="Email, handle, or password is incorrect." />,
        400,
      )
    }
    if (!account.password.startsWith('$argon2id$')) {
      db.query('UPDATE users SET password=? WHERE id=?').run(await hashPassword(password), account.id)
    }
    const session = token()
    insertSession(db, session, account.id, Date.now() + SESSION_LIFETIME_MS, Date.now(),
      c.req.header('user-agent') || '')
    return redirect(next, sessionCookie(session))
  })

  app.get('/forgot-password', c => page(<ForgotPassword />))
  app.post('/forgot-password', async c => {
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    const limited = authLimit(c, 'forgot-password-ip', clientAddress(c), AUTH_LIMITS.forgotIp)
      || authLimit(c, 'forgot-password-account', email || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(page(<ForgotPassword error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    if (!emailPattern.test(email) || email.length > 254) {
      return page(<ForgotPassword error="Enter a valid email address." />, 400)
    }
    const account = db.query(`SELECT id,password FROM users WHERE email=? AND deleted_at IS NULL
      AND suspended_at IS NULL`).get(email) as { id: number; password: string } | null
    if (account && account.password !== '!') {
      const value = token()
      db.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(account.id, Date.now())
      db.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
        .run(hash(value), account.id, Date.now() + 3600000)
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      try {
        await sendPasswordReset(email, `${origin}/reset-password?token=${encodeURIComponent(value)}`)
      }
      catch (error) {
        console.error('Could not send password reset', error)
        db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(value))
        return page(<ForgotPassword error="The reset email could not be sent. Please try again later." />, 503)
      }
    }
    return page(<ForgotPassword sent />)
  })

  app.get('/reset-password', c => {
    const value = c.req.query('token') || ''
    const reset = value && db.query('SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?')
      .get(hash(value), Date.now())
    return page(<ResetPassword resetToken={value} invalid={!reset} />, reset ? 200 : 400)
  })
  app.post('/reset-password', async c => {
    const f = await form(c.req.raw)
    const value = f.token || ''
    const password = f.password || ''
    const limited = authLimit(c, 'reset-password-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || authLimit(c, 'reset-password-token', hash(value), AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(page(<ResetPassword resetToken={value} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const reset = value && db.query('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?')
      .get(hash(value), Date.now()) as { user_id: number } | null
    if (!reset) return page(<ResetPassword invalid />, 400)
    if (password.length < 8 || password.length > 128) {
      return page(<ResetPassword resetToken={value} error="Use a password between 8 and 128 characters." />, 400)
    }
    if (password !== (f.confirmPassword || '')) {
      return page(<ResetPassword resetToken={value} error="Passwords do not match." />, 400)
    }
    const passwordHash = await hashPassword(password)
    db.transaction(() => {
      db.query('UPDATE users SET password=? WHERE id=?').run(passwordHash, reset.user_id)
      db.query('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id)
      db.query('DELETE FROM sessions WHERE user_id=?').run(reset.user_id)
    })()
    return redirect('/enter/password?reset=1')
  })

  app.post('/enter', async c => {
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    const next = safeNext(f.next)
    const limited = isDevelopment()
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
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const link = issueMagicLink(email, account?.id ?? null, next, origin)
    try {
      await sendMagicLink(email, link.url, link.code, account?.handle_chosen_at ? account.handle : undefined)
    }
    catch (error) {
      console.error('Could not send magic link', error)
      const value = new URL(link.url).searchParams.get('token') || ''
      db.query('DELETE FROM magic_links WHERE token_hash=?').run(hash(value))
      return page(
        <Auth email={email} next={next} error="The magic link could not be sent. Please try again later." />,
        503,
      )
    }
    return page(<MagicLinkSent email={email} magicUrl={isDevelopment() ? link.url : undefined} />)
  })

  app.post('/enter/code', async c => {
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    const code = (f.code || '').trim()
    const invalid = () => page(<MagicLinkSent email={email} error="That code is invalid or has expired." />, 400)
    if (!emailPattern.test(email) || !/^\d{6}$/.test(code)) return invalid()
    const limited = authLimit(c, 'enter-code-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || authLimit(c, 'enter-code-account', email, AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(page(<MagicLinkSent email={email} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const link = db.query(`SELECT token_hash,email,user_id,next_path,attempts FROM magic_links
      WHERE email=? AND code_hash IS NOT NULL AND expires_at>?`).get(email, Date.now()) as (MagicLink & {
      attempts: number
    }) | null
    const match = link && db.query('SELECT 1 FROM magic_links WHERE token_hash=? AND code_hash=?')
      .get(link.token_hash, hash(code))
    if (!link || !match) {
      if (link) {
        const attempts = link.attempts + 1
        if (attempts >= 5) db.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
        else db.query('UPDATE magic_links SET attempts=? WHERE token_hash=?').run(attempts, link.token_hash)
      }
      return invalid()
    }
    try {
      const result = completeMagicEntry(link, c.req.header('user-agent') || '')
      return redirect(result.destination, sessionCookie(result.session))
    }
    catch {
      return page(<Auth error="That account is unavailable. Request a new magic link." />, 400)
    }
  })

  app.get('/enter/magic', c => {
    const value = c.req.query('token') || ''
    const link = value && db.query(`SELECT token_hash,email,user_id,next_path FROM magic_links
      WHERE token_hash=? AND expires_at>?`).get(hash(value), Date.now()) as { token_hash: string; email: string;
      user_id: number | null; next_path: string } | null
    if (!link) return page(<Auth error="That magic link is invalid or has expired. Request a new one." />, 400)
    try {
      const result = completeMagicEntry(link, c.req.header('user-agent') || '')
      return redirect(result.destination, sessionCookie(result.session))
    }
    catch {
      return page(<Auth error="That account is unavailable. Request a new magic link." />, 400)
    }
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
    void sendPushForSignup(user.id, handle).catch(error => logError('signup push failed', error))
    return redirect(next)
  })

  app.post('/logout', c => {
    const cookieName = sessionCookieName()
    const session = c.req.header('cookie')?.split(';').map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (session) db.query('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(session))
    return redirect('/', clearSessionCookie())
  })
}
