import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import {
  Auth,
  ForgotPassword,
  ResetPassword,
} from '../components/pages'
import {
  clearSessionCookie,
  sessionCookie,
} from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { hash, hashPassword, token, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueEmailToken, page, redirect, retryPage, safeNext } from './shared'

import type { Hono } from 'hono'
import { db } from '../db'
import { sendPasswordReset } from '../email'
import { createAccount } from '../handles'
import { insertSession, sessionHash } from '../sessions'

export function registerAuthRoutes(app: Hono) {
  app.get('/login', c =>
    page(
      <Auth mode="login" next={safeNext(c.req.query('next'))}
        success={c.req.query('reset') === '1' ? 'Your password has been reset. You can log in now.' : undefined} />,
    ))
  app.get('/signup', c => {
    const requestedNext = c.req.query('next')
    return page(<Auth mode="signup" next={requestedNext ? safeNext(requestedNext) : undefined} />)
  })
  app.get('/forgot-password', c => page(<ForgotPassword />))

  app.post('/forgot-password', async c => {
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    const limited = authLimit(c, 'forgot-ip', clientAddress(c), AUTH_LIMITS.forgotIp)
      || authLimit(c, 'forgot-account', email || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(page(<ForgotPassword error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const user = db.query('SELECT id,email FROM users WHERE email=?').get(email) as { id: number; email: string } | null
    if (user) {
      const resetToken = token()
      db.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(user.id, Date.now())
      db.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
        .run(hash(resetToken), user.id, Date.now() + 3600000)
      const appUrl = Bun.env.APP_URL?.replace(/\/$/, '')
      if (appUrl) {
        try {
          await sendPasswordReset(user.email, `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`)
        }
        catch (error) {
          console.error('Could not send password reset email', error)
          db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(resetToken))
        }
      }
      else {
        console.error('Could not send password reset email: APP_URL is not configured')
        db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(resetToken))
      }
    }
    return page(<ForgotPassword sent />)
  })

  app.get('/reset-password', c => {
    const resetToken = c.req.query('token') || ''
    const reset = resetToken && db.query('SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?')
      .get(hash(resetToken), Date.now())
    return page(<ResetPassword resetToken={resetToken} invalid={!reset} />)
  })

  app.post('/reset-password', async c => {
    const f = await form(c.req.raw)
    const resetToken = f.token || ''
    const limited = authLimit(c, 'reset-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || authLimit(c, 'reset-token', resetToken || '(blank)', AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(page(
        <ResetPassword resetToken={resetToken} error={authRateLimitMessage(limited.retryAfter)}
          invalid={!resetToken} />,
        429,
      ), limited.retryAfter)
    }
    const reset = resetToken && db.query('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?')
      .get(hash(resetToken), Date.now()) as { user_id: number } | null
    if (!reset) return page(<ResetPassword invalid />, 400)
    if ((f.password || '').length < 8 || f.password !== f.confirmPassword) {
      return page(
        <ResetPassword resetToken={resetToken} error="Passwords must match and contain at least 8 characters." />,
        400,
      )
    }
    const passwordHash = await hashPassword(f.password)
    db.transaction(() => {
      db.query('UPDATE users SET password=? WHERE id=?').run(passwordHash, reset.user_id)
      db.query('DELETE FROM sessions WHERE user_id=?').run(reset.user_id)
      db.query('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id)
    })()
    return redirect('/login?reset=1')
  })

  app.post('/signup', async c => {
    const f = await form(c.req.raw)
    const handle = (f.handle || '').toLowerCase().replace(/^@/, '')
    const email = (f.email || '').trim().toLowerCase()
    const next = safeNext(f.next)
    const limited = authLimit(c, 'signup-ip', clientAddress(c), AUTH_LIMITS.signup)
    if (limited) {
      return retryPage(page(
        <Auth mode="signup" handle={handle} email={email} next={next}
          error={authRateLimitMessage(limited.retryAfter)} />,
        429,
      ), limited.retryAfter)
    }
    if (!/^[a-z0-9_]{2,24}$/.test(handle) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || (f.password || '').length < 8)
    {
      return page(
        <Auth mode="signup" handle={handle} email={email} next={next}
          error="Use a valid email, a 2–24 character handle, and a password of at least 8 characters." />,
        400,
      )
    }
    const moderation = await moderateText(`handle: ${handle}`)
    if (!moderation.ok) {
      const error = moderation.reason === 'flagged'
        ? 'That handle may violate our content rules. Please change it and try again.'
        : moderationMessage(moderation.reason)
      return page(
        <Auth mode="signup" handle={handle} email={email} next={next} error={error} />,
        moderation.reason === 'flagged' ? 422 : 503,
      )
    }
    const passwordHash = await hashPassword(f.password)
    try {
      const result = createAccount(db, handle, email, passwordHash)
      const session = token()
      insertSession(db, session, result.id, Date.now() + 2592000000, Date.now(), c.req.header('user-agent') || '')
      try {
        await issueEmailToken(result.id, email, 'verify')
      }
      catch (error) {
        console.error('Could not send verification email', error)
      }
      return redirect(f.next ? next : '/explore?welcome=1', sessionCookie(session))
    }
    catch {
      return page(<Auth mode="signup" handle={handle} email={email} next={next}
        error="That handle or email is unavailable." />,
        400)
    }
  })

  app.post('/login', async c => {
    const f = await form(c.req.raw)
    const login = (f.handle || '').trim().toLowerCase().replace(/^@/, '')
    const ipLimited = authLimit(c, 'login-ip', clientAddress(c), AUTH_LIMITS.loginIp)
    if (ipLimited) {
      return retryPage(page(
        <Auth mode="login" handle={login} next={safeNext(f.next)} error={authRateLimitMessage(ipLimited.retryAfter)} />,
        429,
      ), ipLimited.retryAfter)
    }
    const found = db.query(
      'SELECT id,password FROM users WHERE (handle=? OR email=?) AND deleted_at IS NULL AND suspended_at IS NULL',
    )
      .get(login, login) as { id: number; password: string } | null
    const accountLimited = authLimit(c, 'login-account', found ? `user:${found.id}` : `login:${login || '(blank)'}`,
      AUTH_LIMITS.loginAccount)
    if (accountLimited) {
      return retryPage(page(
        <Auth mode="login" handle={login} next={safeNext(f.next)}
          error={authRateLimitMessage(accountLimited.retryAfter)} />,
        429,
      ), accountLimited.retryAfter)
    }
    if (!found || !await verifyPassword(f.password || '', found.password)) {
      return page(
        <Auth mode="login" handle={login} next={safeNext(f.next)} error="Invalid email, handle, or password." />,
        401,
      )
    }
    if (!found.password.startsWith('$argon2id$')) {
      db.query('UPDATE users SET password=? WHERE id=?').run(await hashPassword(f.password), found.id)
    }
    const session = token()
    insertSession(db, session, found.id, Date.now() + 2592000000, Date.now(), c.req.header('user-agent') || '')
    return redirect(safeNext(f.next), sessionCookie(session))
  })

  app.post('/logout', c => {
    const session = c.req.header('cookie')?.match(/root=([^;]+)/)?.[1]
    if (session) db.query('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(session))
    return redirect('/', clearSessionCookie())
  })
}
