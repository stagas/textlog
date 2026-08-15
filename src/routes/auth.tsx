import { accountForEmail, accountForHandle, accountGroupForUser, createAccountGroup, markGroupEmailVerified,
  MONTHLY_NEW_ACCOUNT_LIMIT, recentAccountCreations, selectAccount } from '../account-groups'
import { AUTH_LIMITS, authRateLimitMessage, loginSubnet } from '../auth-rate-limit'
import { sessionCookieName } from '../brand'
import { Auth, ChooseHandle, ForgotPassword, MagicLinkSent, PasswordLogin, ResetPassword } from '../components/pages'
import { db } from '../db'
import { sendMagicLink, sendPasswordReset } from '../email'
import { isDevelopment } from '../environment'
import { claimInitialHandle } from '../handles'
import { clearSessionCookie, safeLocalPath, sessionCookie } from '../http'
import { logError } from '../log'
import { moderateText, moderationMessage } from '../moderation'
import { consumePasswordCaptcha, issuePasswordCaptcha, passwordCaptchaRequired,
  recordFailedPassword } from '../password-login-captcha'
import { consumePasswordLoginNonce, issuePasswordLoginNonce } from '../password-login-nonce'

const PASSWORD_LOGIN_FAILURE = 'Login was unsuccessful. Check your details and try again.'
class MonthlyAccountLimitError extends Error {}
import { sendPushForSignup } from '../push'
import { insertSession, SESSION_LIFETIME_MS, sessionHash } from '../sessions'
import { currentUser, hash, hashPassword, token, verifyPassword } from '../utils'
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
      const account = db.query(`SELECT handle_chosen_at FROM users
        WHERE id=? AND deleted_at IS NULL AND suspended_at IS NULL`).get(userId) as {
        handle_chosen_at: string | null
      } | null
      if (!account) throw new Error('Account is unavailable')
      chosen = Boolean(account.handle_chosen_at)
      markGroupEmailVerified(db, userId)
      if (!selectAccount(db, userId)) throw new Error('Account is unavailable')
    }
    else {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const created = db.query(`INSERT INTO users(handle,email,password,email_verified_at)
            VALUES(?,?,'!',CURRENT_TIMESTAMP) RETURNING id`).get(temporaryHandle(), link.email) as { id: number }
          userId = created.id
          createAccountGroup(db, userId, link.email)
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
    return page(
      <PasswordLogin nonce={issuePasswordLoginNonce(db, clientAddress(c))} captcha={captcha}
        next={safeNext(c.req.query('next'))} reset={c.req.query('reset') === '1'} />,
    )
  })
  app.post('/enter/password', async c => {
    const f = await form(c.req.raw)
    const identifier = (f.identifier || '').trim().toLowerCase().replace(/^@/, '')
    const password = f.password || ''
    const next = safeNext(f.next)
    const address = clientAddress(c)
    const loginCaptcha = () => passwordCaptchaRequired(db) ? issuePasswordCaptcha(db) : undefined
    if (!consumePasswordLoginNonce(db, f.nonce || '', address)) {
      return page(
        <PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
          captcha={loginCaptcha()} error="This login form has expired or was already used. Please try again." />,
        400,
      )
    }
    if (passwordCaptchaRequired(db)
      && !consumePasswordCaptcha(db, f.captchaToken || '', f.captchaAnswer || ''))
    {
      return page(
        <PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
          captcha={issuePasswordCaptcha(db)} error={PASSWORD_LOGIN_FAILURE} />,
        400,
      )
    }
    const limited = authLimit(c, 'password-login-ip', address, AUTH_LIMITS.loginIp)
      || authLimit(c, 'password-login-subnet', loginSubnet(address), AUTH_LIMITS.loginSubnet)
      || authLimit(c, 'password-login-account', identifier || '(blank)', AUTH_LIMITS.loginAccount)
    if (limited) {
      return retryPage(
        page(
          <PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
            captcha={loginCaptcha()} error={authRateLimitMessage(limited.retryAfter)} />,
          429,
        ),
        limited.retryAfter,
      )
    }
    const account = emailPattern.test(identifier)
      ? accountForEmail(db, identifier)
      : accountForHandle(db, identifier)
    const valid = await verifyPassword(password, account?.password !== '!' && account?.password
      ? account.password
      : await dummyPasswordHash)
    if (!account || account.password === '!' || !valid) {
      recordFailedPassword(db)
      return page(
        <PasswordLogin nonce={issuePasswordLoginNonce(db, address)} identifier={identifier} next={next}
          captcha={loginCaptcha()} error={PASSWORD_LOGIN_FAILURE} />,
        400,
      )
    }
    if (!account.password.startsWith('$argon2id$')) {
      db.query('UPDATE users SET password=? WHERE id=?').run(await hashPassword(password), account.id)
    }
    selectAccount(db, account.id)
    const session = token()
    insertSession(db, session, account.id, Date.now() + SESSION_LIFETIME_MS, Date.now(),
      c.req.header('user-agent') || '')
    return redirect(next, sessionCookie(session))
  })

  app.get('/forgot-password', c => page(<ForgotPassword />))
  app.post('/forgot-password', async c => {
    const f = await form(c.req.raw)
    const submittedIdentifier = (f.identifier || f.email || '').trim().toLowerCase()
    const identifier = submittedIdentifier.replace(/^@/, '')
    const limited = authLimit(c, 'forgot-password-ip', clientAddress(c), AUTH_LIMITS.forgotIp)
      || authLimit(c, 'forgot-password-account', identifier || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(page(<ForgotPassword identifier={submittedIdentifier}
        error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const isEmail = emailPattern.test(identifier) && identifier.length <= 254
    const isHandle = /^[a-z0-9_]{2,24}$/.test(identifier)
    if (!isEmail && !isHandle) {
      return page(<ForgotPassword identifier={submittedIdentifier}
        error="Enter a valid email address or handle." />, 400)
    }
    const account = isEmail ? accountForEmail(db, identifier) : accountForHandle(db, identifier)
    if (account && account.password !== '!') {
      const value = token()
      db.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(account.id, Date.now())
      db.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
        .run(hash(value), account.id, Date.now() + 3600000)
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      try {
        await sendPasswordReset(account.email, `${origin}/reset-password?token=${encodeURIComponent(value)}`)
      }
      catch (error) {
        console.error('Could not send password reset', error)
        db.query('DELETE FROM password_resets WHERE token_hash=?').run(hash(value))
        return page(<ForgotPassword identifier={submittedIdentifier}
          error="The reset email could not be sent. Please try again later." />, 503)
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
    const identifier = (f.identifier || f.email || '').trim().toLowerCase()
    const next = safeNext(f.next)
    const limited = isDevelopment()
      ? null
      : authLimit(c, 'enter-ip', clientAddress(c), AUTH_LIMITS.loginIp)
        || authLimit(c, 'enter-email', identifier || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(
        page(<Auth email={identifier} next={next} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter,
      )
    }

    const account = emailPattern.test(identifier)
      ? accountForEmail(db, identifier)
      : accountForHandle(db, identifier.replace(/^@/, ''))
    if ((!account && !emailPattern.test(identifier)) || identifier.length > 254) {
      return page(<Auth email={identifier} next={next} error="Enter a valid email address or handle." />, 400)
    }
    const email = account?.email || identifier
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
    return page(
      <MagicLinkSent email={identifier} handle={!emailPattern.test(identifier)}
        magicUrl={isDevelopment() ? link.url : undefined} />,
    )
  })

  app.post('/enter/code', async c => {
    const f = await form(c.req.raw)
    const identifier = (f.identifier || f.email || '').trim().toLowerCase()
    const code = (f.code || '').trim()
    const account = accountForHandle(db, identifier.replace(/^@/, ''))
    const email = emailPattern.test(identifier) ? identifier : account?.email
    const handle = !emailPattern.test(identifier)
    const invalid = () =>
      page(<MagicLinkSent email={identifier} handle={handle} error="That code is invalid or has expired." />, 400)
    if (!email || !/^\d{6}$/.test(code)) return invalid()
    const limited = authLimit(c, 'enter-code-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || authLimit(c, 'enter-code-account', identifier, AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(
        page(<MagicLinkSent email={identifier} handle={handle} error={authRateLimitMessage(limited.retryAfter)} />,
          429),
        limited.retryAfter,
      )
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
    const submittedHandle = f.handle || ''
    const handle = submittedHandle.trim().toLowerCase().replace(/^@/, '')
    const next = safeNext(f.next)
    if (!/^[a-z0-9_]{2,24}$/.test(handle)) {
      const characters = Array.from(submittedHandle).length
      return page(
        <ChooseHandle handle={submittedHandle} next={next}
          error={`You typed ${characters} ${
            characters === 1 ? 'character' : 'characters'
          }. Use 2–24 letters, numbers, or underscores.`} />,
        400,
      )
    }
    const moderation = await moderateText(`handle: ${handle}`)
    if (!moderation.ok) {
      return page(<ChooseHandle handle={handle} next={next} error={moderation.reason === 'flagged'
        ? 'That handle may violate our content rules. Please choose another.'
        : moderationMessage(moderation.reason)} />, moderation.reason === 'flagged' ? 422 : 503)
    }
    try {
      claimInitialHandle(db, user.id, handle, reclaimed => {
        const group = accountGroupForUser(db, user.id)
        if (!group || group.primary_user_id === user.id || reclaimed) return
        if (recentAccountCreations(db, group.id) >= MONTHLY_NEW_ACCOUNT_LIMIT) {
          throw new MonthlyAccountLimitError()
        }
        db.query('INSERT INTO account_creation_events(account_group_id,user_id) VALUES(?,?)').run(group.id, user.id)
      })
    }
    catch (error) {
      if (error instanceof MonthlyAccountLimitError) {
        return page(
          <ChooseHandle handle={handle} next={next}
            error="You can create up to two new accounts per month. Choose a handle from one of your deleted accounts to reclaim it, or try again later." />,
          429,
        )
      }
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
