import { anonymizeUser, isAdmin } from '../admin'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { currentUser, hashPassword, sessionToken, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueEmailToken, page, redirect, retryPage, securityPage } from './shared'

import type { Hono } from 'hono'
import {
  ConfirmAccountDelete,
  ConfirmEmail,
  Profile,
} from '../components/pages'
import { exportUserData } from '../data-export'
import { db } from '../db'
import { confirmEmailToken, findEmailToken } from '../email-verification'
import { updateProfileHandle } from '../handles'
import {
  clearSessionCookie,
} from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { sessionHash } from '../sessions'

export function registerAccountRoutes(app: Hono) {
  app.get('/account/edit', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login?next=' + encodeURIComponent('/account/edit'))
    return page(<Profile user={user} profile={user} posts={[]} following={false} editing />)
  })

  app.post('/account/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
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

  app.get('/account/security', c =>
    securityPage(c.req.raw, undefined, c.req.query('changed') === 'password'
      ? 'Password changed. Other sessions were revoked.'
      : c.req.query('changed') === 'email'
      ? 'Email address verified and changed.'
      : c.req.query('verified') === '1'
      ? 'Email address verified.'
      : undefined))

  app.get('/account/export', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login?next=' + encodeURIComponent('/account/export'))
    const data = exportUserData(db, user.id, sessionToken(c.req.raw))
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="root-mx-${user.handle}-data.json"`,
        'cache-control': 'no-store',
      },
    })
  })

  app.post('/account/email/verify', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    if (user.email_verified_at) return redirect('/explore?welcome=1')
    const limited = authLimit(c, 'verify-email', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.forgotAccount)
    if (limited) {
      return retryPage(page(<ConfirmEmail pending email={user.email}
        error={authRateLimitMessage(limited.retryAfter)} />, 429), limited.retryAfter)
    }
    try {
      await issueEmailToken(user.id, user.email, 'verify')
      return redirect('/verify-email?sent=1')
    }
    catch (error) {
      console.error('Could not send verification email', error)
      return page(<ConfirmEmail pending email={user.email}
        error="Verification email could not be sent. Please try again later." />, 503)
    }
  })

  app.post('/account/email/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
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
    const account = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    if (!await verifyPassword(f.password || '', account.password)) {
      return securityPage(c.req.raw, 'Your current password is incorrect.', undefined, 401)
    }
    if (db.query('SELECT 1 FROM users WHERE email=? AND id!=?').get(email, user.id)) {
      return securityPage(c.req.raw, 'That email address is unavailable.', undefined, 400)
    }
    try {
      await issueEmailToken(user.id, email, 'change')
      return securityPage(c.req.raw, undefined, 'A confirmation link was sent to your new email address.')
    }
    catch (error) {
      console.error('Could not send email-change confirmation', error)
      return securityPage(c.req.raw, 'Confirmation email could not be sent. Please try again later.', undefined, 503)
    }
  })

  app.get('/verify-email', c => {
    const value = c.req.query('token') || ''
    if (!value) {
      const user = currentUser(c.req.raw)
      if (!user) return redirect('/login')
      if (user.email_verified_at) return redirect('/explore?welcome=1')
      return page(<ConfirmEmail pending email={user.email} sent={c.req.query('sent') === '1'} />)
    }
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

  app.post('/verify-email/dev', c => {
    if (Bun.env.NODE_ENV !== 'development' && Bun.env.DEV_RELOAD !== 'true') return c.notFound()
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    db.query('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id)
    db.query("DELETE FROM email_tokens WHERE user_id=? AND kind='verify'").run(user.id)
    return redirect('/explore?welcome=1')
  })

  app.post('/account/password', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    const limited = authLimit(c, 'account-password', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
        limited.retryAfter)
    }
    const f = await form(c.req.raw)
    const account = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    if (!await verifyPassword(f.currentPassword || '', account.password)) {
      return securityPage(c.req.raw, 'Your current password is incorrect.', undefined, 401)
    }
    if ((f.password || '').length < 8 || f.password !== f.confirmPassword) {
      return securityPage(c.req.raw, 'New passwords must match and contain at least 8 characters.', undefined, 400)
    }
    const current = sessionHash(sessionToken(c.req.raw))
    const password = await hashPassword(f.password)
    db.transaction(() => {
      db.query('UPDATE users SET password=? WHERE id=?').run(password, user.id)
      db.query('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(user.id, current)
      db.query('DELETE FROM password_resets WHERE user_id=?').run(user.id)
    })()
    return redirect('/account/security?changed=password')
  })

  app.post('/account/sessions/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
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
    if (!user) return redirect('/login')
    db.query('DELETE FROM sessions WHERE user_id=? AND token_hash!=?')
      .run(user.id, sessionHash(sessionToken(c.req.raw)))
    return redirect('/account/security')
  })

  app.get('/account/delete', c => {
    const user = currentUser(c.req.raw)
    return user ? page(<ConfirmAccountDelete user={user} />) : redirect('/login')
  })

  app.post('/account/delete', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/login')
    if (isAdmin(user)) return c.text('Admin accounts cannot delete themselves', 403)
    const f = await form(c.req.raw)
    const account = db.query('SELECT password FROM users WHERE id=? AND deleted_at IS NULL')
      .get(user.id) as { password: string } | null
    if (!account || !await verifyPassword(f.password || '', account.password)) {
      return page(<ConfirmAccountDelete user={user} error="Your password is incorrect." />, 401)
    }
    db.transaction(() => anonymizeUser(db, user.id))()
    return redirect('/', clearSessionCookie())
  })
}
