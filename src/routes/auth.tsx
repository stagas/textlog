import { AUTH_LIMITS, authRateLimitMessage, loginSubnet } from '../auth-rate-limit'
import { sessionCookieName } from '../brand'
import { Auth, ChooseHandle, ForgotPassword, MagicLinkSent, PasswordLogin, ResetPassword } from '../components/pages'
import { sendMagicLink, sendPasswordReset } from '../email'
import { isDevelopment } from '../environment'
import { clearSessionCookie, safeLocalPath, sessionCookie } from '../http'
import { logError } from '../log'
import { moderateText, moderationMessage } from '../moderation'

const PASSWORD_LOGIN_FAILURE = 'Login was unsuccessful. Check your details and try again.'
import { sendPushForSignup } from '../push'
import { databaseService } from '../database-service'
import { sessionHash } from '../sessions'
import { currentUser, hash, hashPassword, token, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueMagicLink, page, redirect, retryPage, safeNext } from './shared'

import type { Hono } from 'hono'

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const dummyPasswordHash = hashPassword(crypto.randomUUID())
export function registerAuthRoutes(app: Hono) {
  app.get('/enter', c => page(<Auth next={safeNext(c.req.query('next'))} />))
  app.get('/login',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))
  app.get('/signup',
    c => redirect('/enter' + (c.req.query('next') ? `?next=${encodeURIComponent(safeNext(c.req.query('next')))}` : '')))

  app.get('/enter/password', async c => {
    const challenge = await databaseService().call('auth.passwordLoginChallenge', {
      address: clientAddress(c), now: Date.now(),
    })
    return page(
      <PasswordLogin nonce={challenge.nonce} captcha={challenge.captcha}
        next={safeNext(c.req.query('next'))} reset={c.req.query('reset') === '1'} />,
    )
  })
  app.post('/enter/password', async c => {
    const f = await form(c.req.raw)
    const identifier = (f.identifier || '').trim().toLowerCase().replace(/^@/, '')
    const password = f.password || ''
    const next = safeNext(f.next)
    const address = clientAddress(c)
    const validation = await databaseService().call('auth.validatePasswordLoginForm', {
      address, nonce: f.nonce || '', captchaToken: f.captchaToken || '', captchaAnswer: f.captchaAnswer || '',
      now: Date.now(),
    })
    if (validation.status === 'invalid_nonce') {
      const challenge = await databaseService().call('auth.passwordLoginChallenge', { address, now: Date.now() })
      return page(
        <PasswordLogin nonce={challenge.nonce} identifier={identifier} next={next}
          captcha={challenge.captcha} error="This login form has expired or was already used. Please try again." />,
        400,
      )
    }
    if (validation.status === 'invalid_captcha') {
      const challenge = await databaseService().call('auth.passwordLoginChallenge', {
        address, now: Date.now(), forceCaptcha: true,
      })
      return page(
        <PasswordLogin nonce={challenge.nonce} identifier={identifier} next={next}
          captcha={challenge.captcha} error={PASSWORD_LOGIN_FAILURE} />,
        400,
      )
    }
    const limited = await authLimit(c, 'password-login-ip', address, AUTH_LIMITS.loginIp)
      || await authLimit(c, 'password-login-subnet', loginSubnet(address), AUTH_LIMITS.loginSubnet)
      || await authLimit(c, 'password-login-account', identifier || '(blank)', AUTH_LIMITS.loginAccount)
    if (limited) {
      const challenge = await databaseService().call('auth.passwordLoginChallenge', { address, now: Date.now() })
      return retryPage(
        page(
          <PasswordLogin nonce={challenge.nonce} identifier={identifier} next={next}
            captcha={challenge.captcha} error={authRateLimitMessage(limited.retryAfter)} />,
          429,
        ),
        limited.retryAfter,
      )
    }
    const account = await databaseService().call('auth.accountForIdentifier', {
      identifier, isEmail: emailPattern.test(identifier),
    })
    const valid = await verifyPassword(password, account?.password !== '!' && account?.password
      ? account.password
      : await dummyPasswordHash)
    if (!account || account.password === '!' || !valid) {
      await databaseService().call('auth.recordFailedPassword', { now: Date.now() })
      const challenge = await databaseService().call('auth.passwordLoginChallenge', { address, now: Date.now() })
      return page(
        <PasswordLogin nonce={challenge.nonce} identifier={identifier} next={next}
          captcha={challenge.captcha} error={PASSWORD_LOGIN_FAILURE} />,
        400,
      )
    }
    const replacementPasswordHash = account.password.startsWith('$argon2id$') ? null : await hashPassword(password)
    const result = await databaseService().call('auth.completePasswordLogin', {
      userId: account.id, replacementPasswordHash, now: Date.now(), userAgent: c.req.header('user-agent') || '',
    })
    return redirect(next, sessionCookie(result.session))
  })

  app.get('/forgot-password', c => page(<ForgotPassword />))
  app.post('/forgot-password', async c => {
    const f = await form(c.req.raw)
    const submittedIdentifier = (f.identifier || f.email || '').trim().toLowerCase()
    const identifier = submittedIdentifier.replace(/^@/, '')
    const limited = await authLimit(c, 'forgot-password-ip', clientAddress(c), AUTH_LIMITS.forgotIp)
      || await authLimit(c, 'forgot-password-account', identifier || '(blank)', AUTH_LIMITS.forgotAccount)
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
    const value = token()
    const tokenHash = hash(value)
    const now = Date.now()
    const reset = await databaseService().call('auth.preparePasswordReset', {
      identifier, isEmail, tokenHash, expiresAt: now + 3600000, now,
    })
    if (reset) {
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      try {
        await sendPasswordReset(reset.email, `${origin}/reset-password?token=${encodeURIComponent(value)}`)
      }
      catch (error) {
        console.error('Could not send password reset', error)
        await databaseService().call('auth.deletePasswordReset', { tokenHash })
        return page(<ForgotPassword identifier={submittedIdentifier}
          error="The reset email could not be sent. Please try again later." />, 503)
      }
    }
    return page(<ForgotPassword sent />)
  })

  app.get('/reset-password', async c => {
    const value = c.req.query('token') || ''
    const reset = Boolean(value) && await databaseService().call('auth.passwordResetValid', {
      tokenHash: hash(value), now: Date.now(),
    })
    return page(<ResetPassword resetToken={value} invalid={!reset} />, reset ? 200 : 400)
  })
  app.post('/reset-password', async c => {
    const f = await form(c.req.raw)
    const value = f.token || ''
    const password = f.password || ''
    const limited = await authLimit(c, 'reset-password-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || await authLimit(c, 'reset-password-token', hash(value), AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(page(<ResetPassword resetToken={value} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const resetValid = Boolean(value) && await databaseService().call('auth.passwordResetValid', {
      tokenHash: hash(value), now: Date.now(),
    })
    if (!resetValid) return page(<ResetPassword invalid />, 400)
    if (password.length < 8 || password.length > 128) {
      return page(<ResetPassword resetToken={value} error="Use a password between 8 and 128 characters." />, 400)
    }
    if (password !== (f.confirmPassword || '')) {
      return page(<ResetPassword resetToken={value} error="Passwords do not match." />, 400)
    }
    const passwordHash = await hashPassword(password)
    const consumed = await databaseService().call('auth.consumePasswordReset', {
      tokenHash: hash(value), passwordHash, now: Date.now(),
    })
    if (!consumed) return page(<ResetPassword invalid />, 400)
    return redirect('/enter/password?reset=1')
  })

  app.post('/enter', async c => {
    const f = await form(c.req.raw)
    const identifier = (f.identifier || f.email || '').trim().toLowerCase()
    const next = safeNext(f.next)
    const limited = isDevelopment()
      ? null
      : await authLimit(c, 'enter-ip', clientAddress(c), AUTH_LIMITS.loginIp)
        || await authLimit(c, 'enter-email', identifier || '(blank)', AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(
        page(<Auth email={identifier} next={next} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter,
      )
    }

    const account = await databaseService().call('auth.accountForIdentifier', {
      identifier: identifier.replace(/^@/, ''), isEmail: emailPattern.test(identifier),
    })
    if ((!account && !emailPattern.test(identifier)) || identifier.length > 254) {
      return page(<Auth email={identifier} next={next} error="Enter a valid email address or handle." />, 400)
    }
    const email = account?.email || identifier
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const link = await issueMagicLink(email, account?.id ?? null, next, origin)
    try {
      await sendMagicLink(email, link.url, link.code, account?.handleChosenAt ? account.handle : undefined)
    }
    catch (error) {
      console.error('Could not send magic link', error)
      await databaseService().call('auth.deleteMagicLink', { tokenHash: link.tokenHash })
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
    const account = await databaseService().call('auth.accountForIdentifier', {
      identifier: identifier.replace(/^@/, ''), isEmail: false,
    })
    const email = emailPattern.test(identifier) ? identifier : account?.email
    const handle = !emailPattern.test(identifier)
    const invalid = () =>
      page(<MagicLinkSent email={identifier} handle={handle} error="That code is invalid or has expired." />, 400)
    if (!email || !/^\d{6}$/.test(code)) return invalid()
    const limited = await authLimit(c, 'enter-code-ip', clientAddress(c), AUTH_LIMITS.resetIp)
      || await authLimit(c, 'enter-code-account', identifier, AUTH_LIMITS.resetToken)
    if (limited) {
      return retryPage(
        page(<MagicLinkSent email={identifier} handle={handle} error={authRateLimitMessage(limited.retryAfter)} />,
          429),
        limited.retryAfter,
      )
    }
    const result = await databaseService().call('auth.consumeMagicLink', {
      selector: { email, codeHash: hash(code) }, userAgent: c.req.header('user-agent') || '', now: Date.now(),
    })
    if (result.status === 'invalid') return invalid()
    if (result.status === 'unavailable') {
      return page(<Auth error="That account is unavailable. Request a new magic link." />, 400)
    }
    return redirect(result.destination, sessionCookie(result.session))
  })

  app.get('/enter/magic', async c => {
    const value = c.req.query('token') || ''
    if (!value) return page(<Auth error="That magic link is invalid or has expired. Request a new one." />, 400)
    const result = await databaseService().call('auth.consumeMagicLink', {
      selector: { tokenHash: hash(value) }, userAgent: c.req.header('user-agent') || '', now: Date.now(),
    })
    if (result.status === 'invalid') {
      return page(<Auth error="That magic link is invalid or has expired. Request a new one." />, 400)
    }
    if (result.status === 'unavailable') {
      return page(<Auth error="That account is unavailable. Request a new magic link." />, 400)
    }
    return redirect(result.destination, sessionCookie(result.session))
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
    const claimed = await databaseService().call('auth.claimInitialHandle', { userId: user.id, handle })
    if (claimed.status !== 'ready') {
      if (claimed.status === 'monthly_limit') {
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

  app.post('/logout', async c => {
    const cookieName = sessionCookieName()
    const session = c.req.header('cookie')?.split(';').map(cookie => cookie.trim())
      .find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (session) await databaseService().call('auth.logout', { tokenHash: sessionHash(session) })
    return redirect('/', clearSessionCookie())
  })
}
