import { anonymizeUser, isAdmin } from '../admin'
import { accountForDeletionToken, issueAccountDeletionToken } from '../account-deletion'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { currentUser, hash, hashPassword, sessionToken, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueEmailToken, issueMagicLink, page, redirect, retryPage,
  securityPage } from './shared'

import type { Hono } from 'hono'
import {
  AccountMagicLink,
  AccountPassword,
  ChangeTheme,
  ChangeFont,
  ConfirmAccountDelete,
  ConfirmEmail,
  Profile,
} from '../components/pages'
import { exportUserData } from '../data-export'
import { db } from '../db'
import { sendAccountDeletionConfirmation, sendEmailChangeAuthorization, sendPasswordEnableConfirmation } from '../email'
import { emailChangeForToken, issueEmailChangeAuthorization } from '../email-change-authorization'
import { confirmEmailToken, findEmailToken } from '../email-verification'
import { updateProfileHandle } from '../handles'
import {
  clearSessionCookie,
} from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { sessionHash } from '../sessions'
import { accountForPasswordEnableToken, issuePasswordEnableToken } from '../password-enable'
import { ACCENT_CHOICES, appearance, appearanceCookie, FONT_CHOICES, fontChoice, fontCookie, THEME_CHOICES, type AccentChoice, type FontChoice, type ThemeChoice } from '../theme'

export function registerAccountRoutes(app: Hono) {
  app.get('/account/edit', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit'))
    return page(<Profile user={user} profile={user} posts={[]} following={false} editing />)
  })

  app.post('/account/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    // Preserve whitespace because spaces and line breaks can be meaningful in ASCII art.
    // Treat an entirely blank submission as an empty bio, though.
    const submittedBio = f.bio || ''
    const bio = submittedBio.trim() ? submittedBio : ''
    const handle = (f.handle || '').toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_]{2,24}$/.test(handle) || bio.length > 160) {
      return page(
        <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={handle} editing
          error="Use a 2–24 character username and a bio up to 160 characters." />,
        400,
      )
    }
    if (handle || bio) {
      const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
      if (!moderation.ok) {
        return page(
          <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={handle} editing
            error={moderationMessage(moderation.reason)} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
    }
    try {
      updateProfileHandle(db, user.id, handle, bio)
    }
    catch {
      return page(
        <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={handle} editing
          error="That username is unavailable." />,
        400,
      )
    }
    return redirect('/u/' + handle)
  })

  app.get('/account/edit/theme', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/theme'))
    return page(<ChangeTheme user={user} selected={appearance(c.req.raw)} />)
  })

  app.post('/account/edit/theme', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const theme = f.theme as ThemeChoice
    const accent = f.accent as AccentChoice
    if (!THEME_CHOICES.includes(theme) || !ACCENT_CHOICES.includes(accent)) {
      return page(<ChangeTheme user={user} selected={appearance(c.req.raw)} />, 400)
    }
    return redirect('/account/edit/theme', appearanceCookie({ theme, accent }))
  })

  app.get('/account/edit/font', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/font'))
    return page(<ChangeFont user={user} selected={fontChoice(c.req.raw)} />)
  })

  app.post('/account/edit/font', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const selected = (await form(c.req.raw)).font as FontChoice
    if (!FONT_CHOICES.some(font => font.value === selected)) {
      return page(<ChangeFont user={user} selected={fontChoice(c.req.raw)} />, 400)
    }
    return redirect('/account/edit/font', fontCookie(selected))
  })

  app.get('/account/security', c =>
    securityPage(c.req.raw, undefined, c.req.query('enabled') === 'password'
      ? 'Password login enabled.'
      : c.req.query('changed') === 'password'
      ? 'Password changed. Other sessions were revoked.'
      : c.req.query('changed') === 'email'
      ? 'Email address verified and changed.'
      : c.req.query('verified') === '1'
      ? 'Email address verified.'
      : undefined))

  app.get('/account/password/enable', c => {
    const user = currentUser(c.req.raw)
    const value = c.req.query('token') || ''
    if (value) return accountForPasswordEnableToken(db, value)
      ? page(<AccountPassword user={user} enabled={false} token={value} />)
      : page(<AccountPassword user={user} enabled={false} invalid />, 400)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/password/enable'))
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    return credentials.password === '!' ? page(<AccountPassword user={user} enabled={false} request />)
      : redirect('/account/password/change')
  })
  app.post('/account/password/enable', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const limited = authLimit(c, 'password-enable', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) return retryPage(page(<AccountPassword user={user} enabled={false} request={!f.token}
      token={f.token || undefined}
      error={authRateLimitMessage(limited.retryAfter)} />, 429), limited.retryAfter)
    const tokenAccount = accountForPasswordEnableToken(db, f.token || '')
    if (!f.token) {
      const current = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
      if (current.password !== '!') return redirect('/account/password/change')
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      const value = issuePasswordEnableToken(db, user.id, user.email)
      try {
        await sendPasswordEnableConfirmation(user.email,
          `${origin}/account/password/enable?token=${encodeURIComponent(value)}`)
      }
      catch (error) {
        db.query('DELETE FROM password_enable_tokens WHERE token_hash=?').run(hash(value))
        console.error('Could not send password-enable confirmation', error)
        return page(<AccountPassword user={user} enabled={false} request
          error="Setup email could not be sent. Please try again later." />, 503)
      }
      return page(<AccountPassword user={user} enabled={false} sent />)
    }
    if (!tokenAccount) return page(<AccountPassword user={user} enabled={false} invalid />, 400)
    const password = f.newPassword || ''
    if (password.length < 8 || password.length > 128) return page(<AccountPassword user={user} enabled={false}
      token={f.token}
      error="Use a password between 8 and 128 characters." />, 400)
    const passwordHash = await hashPassword(password)
    db.transaction(() => {
      db.query('UPDATE users SET password=? WHERE id=? AND password=?')
        .run(passwordHash, tokenAccount.id, '!')
      db.query('DELETE FROM password_enable_tokens WHERE user_id=?').run(tokenAccount.id)
    })()
    return redirect('/account/security?enabled=password')
  })

  app.get('/account/password/change', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/password/change'))
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    return credentials.password === '!' ? redirect('/account/password/enable')
      : page(<AccountPassword user={user} enabled />)
  })
  app.post('/account/password/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = authLimit(c, 'password-change', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) return retryPage(page(<AccountPassword user={user} enabled
      error={authRateLimitMessage(limited.retryAfter)} />, 429), limited.retryAfter)
    const f = await form(c.req.raw)
    const oldPassword = f.oldPassword || ''
    const newPassword = f.newPassword || ''
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    if (credentials.password === '!') return redirect('/account/password/enable')
    if (!await verifyPassword(oldPassword, credentials.password)) return page(<AccountPassword user={user} enabled
      error="Old password is incorrect." />, 400)
    if (newPassword.length < 8 || newPassword.length > 128) return page(<AccountPassword user={user} enabled
      error="Use a password between 8 and 128 characters." />, 400)
    if (oldPassword === newPassword) return page(<AccountPassword user={user} enabled
      error="Choose a password different from your old password." />, 400)
    const currentSession = sessionHash(sessionToken(c.req.raw))
    const newPasswordHash = await hashPassword(newPassword)
    db.transaction(() => {
      db.query('UPDATE users SET password=? WHERE id=?').run(newPasswordHash, user.id)
      db.query('DELETE FROM password_resets WHERE user_id=?').run(user.id)
      db.query('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(user.id, currentSession)
    })()
    return redirect('/account/security?changed=password')
  })

  app.post('/account/magic-link', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/security'))
    const limited = authLimit(c, 'account-magic-link', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
        limited.retryAfter)
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const { url: magicUrl, code } = issueMagicLink(user.email, user.id, '/', origin)
    return page(<AccountMagicLink user={user} magicUrl={magicUrl} code={code} />)
  })

  app.get('/account/export', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/export'))
    const data = exportUserData(db, user.id, sessionToken(c.req.raw))
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="textlog-${user.handle}-data.json"`,
        'cache-control': 'no-store',
      },
    })
  })

  app.post('/account/email/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    if (isAdmin(user)) {
      return securityPage(c.req.raw, 'Hardcoded admin accounts cannot change their protected email.', undefined, 403)
    }
    const limited = authLimit(c, 'account-email', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
        limited.retryAfter)
    }
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return securityPage(c.req.raw, 'Enter a valid email address.', undefined, 400)
    }
    if (db.query('SELECT 1 FROM users WHERE email=? AND id!=?').get(email, user.id)) {
      return securityPage(c.req.raw, 'That email address is unavailable.', undefined, 400)
    }
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    if (credentials.password !== '!' && !await verifyPassword(f.password || '', credentials.password)) {
      return securityPage(c.req.raw, 'Password is incorrect.', undefined, 400)
    }
    try {
      if (credentials.password !== '!') {
        await issueEmailToken(user.id, email, 'change')
        return securityPage(c.req.raw, undefined, 'A confirmation link was sent to your new email address.')
      }
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      const value = issueEmailChangeAuthorization(db, user.id, user.email, email)
      await sendEmailChangeAuthorization(user.email,
        `${origin}/account/email/change/authorize?token=${encodeURIComponent(value)}`)
      return securityPage(c.req.raw, undefined, 'An approval link was sent to your current email address.')
    }
    catch (error) {
      db.query('DELETE FROM email_change_authorizations WHERE user_id=?').run(user.id)
      console.error('Could not send email-change confirmation', error)
      return securityPage(c.req.raw, 'Confirmation email could not be sent. Please try again later.', undefined, 503)
    }
  })

  app.get('/account/email/change/authorize', c => {
    const value = c.req.query('token') || ''
    const change = emailChangeForToken(db, value)
    return change ? page(<ConfirmEmail token={value} kind="authorize-change" email={change.new_email} />)
      : page(<ConfirmEmail invalid />, 400)
  })

  app.post('/account/email/change/authorize', async c => {
    const f = await form(c.req.raw)
    const value = f.token || ''
    const change = emailChangeForToken(db, value)
    if (!change) return page(<ConfirmEmail invalid />, 400)
    try {
      await issueEmailToken(change.user_id, change.new_email, 'change')
      db.query('DELETE FROM email_change_authorizations WHERE user_id=?').run(change.user_id)
      return page(<ConfirmEmail pending email={change.new_email} />)
    }
    catch (error) {
      console.error('Could not send new-email confirmation', error)
      return page(<ConfirmEmail token={value} kind="authorize-change" email={change.new_email}
        error="Confirmation email could not be sent. Please try again later." />, 503)
    }
  })

  app.get('/verify-email', c => {
    const value = c.req.query('token') || ''
    if (!value) return redirect('/account/security')
    const record = findEmailToken(db, value)
    return record
      ? page(<ConfirmEmail token={value} kind={record.kind} email={record.email} />)
      : page(<ConfirmEmail invalid />, 400)
  })

  app.post('/verify-email', async c => {
    const f = await form(c.req.raw)
    const result = confirmEmailToken(db, f.token || '')
    if (!result.ok) return page(<ConfirmEmail invalid />, 400)
    return redirect(result.kind === 'change' ? '/account/security?changed=email' : '/explore?welcome=1')
  })

  app.post('/account/sessions/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const current = sessionHash(sessionToken(c.req.raw))
    const sessions = db.query('SELECT token_hash FROM sessions WHERE user_id=?').all(user.id) as {
      token_hash: string
    }[]
    const target = sessions.find(session => session.token_hash === f.token && session.token_hash !== current)
    if (target) db.query('DELETE FROM sessions WHERE token_hash=? AND user_id=?').run(target.token_hash, user.id)
    return redirect('/account/security')
  })

  app.post('/account/sessions/revoke-others', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    db.query('DELETE FROM sessions WHERE user_id=? AND token_hash!=?')
      .run(user.id, sessionHash(sessionToken(c.req.raw)))
    return redirect('/account/security')
  })

  app.get('/account/delete', c => {
    const value = c.req.query('token') || ''
    if (value) {
      return accountForDeletionToken(db, value)
        ? page(<ConfirmAccountDelete user={currentUser(c.req.raw)} token={value} />)
        : page(<ConfirmAccountDelete user={currentUser(c.req.raw)} invalid />, 400)
    }
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    return page(<ConfirmAccountDelete user={user} passwordEnabled={credentials.password !== '!'} />)
  })

  app.post('/account/delete', async c => {
    const user = currentUser(c.req.raw)
    const f = await form(c.req.raw)
    const deletionAccount = accountForDeletionToken(db, f.token || '')
    if (deletionAccount) {
      if (isAdmin({ email: deletionAccount.email })) return c.text('Admin accounts cannot delete themselves', 403)
      db.transaction(() => anonymizeUser(db, deletionAccount.id))()
      return redirect('/', clearSessionCookie())
    }
    if (f.token) return page(<ConfirmAccountDelete user={user} invalid />, 400)
    if (!user) return redirect('/enter')
    if (isAdmin(user)) return c.text('Admin accounts cannot delete themselves', 403)
    const limited = authLimit(c, 'account-delete', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    const passwordEnabled = credentials.password !== '!'
    if (limited) return retryPage(page(<ConfirmAccountDelete user={user} passwordEnabled={passwordEnabled}
      error={authRateLimitMessage(limited.retryAfter)} />, 429), limited.retryAfter)
    if (passwordEnabled) {
      if (!await verifyPassword(f.password || '', credentials.password)) {
        return page(<ConfirmAccountDelete user={user} passwordEnabled error="Password is incorrect." />, 400)
      }
      db.transaction(() => anonymizeUser(db, user.id))()
      return redirect('/', clearSessionCookie())
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const value = issueAccountDeletionToken(db, user.id, user.email)
    try {
      await sendAccountDeletionConfirmation(user.email,
        `${origin}/account/delete?token=${encodeURIComponent(value)}`)
    }
    catch (error) {
      db.query('DELETE FROM account_deletion_tokens WHERE token_hash=?').run(hash(value))
      console.error('Could not send account-deletion confirmation', error)
      return page(<ConfirmAccountDelete user={user}
        error="Confirmation email could not be sent. Please try again later." />, 503)
    }
    return page(<ConfirmAccountDelete user={user} sent />)
  })
}
