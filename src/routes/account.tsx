import { accountForDeletionToken, issueAccountDeletionToken } from '../account-deletion'
import { anonymizeUser, isAdmin } from '../admin'
import { issueApiKey } from '../api-keys'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { currentUser, hash, hashPassword, sessionToken, token, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueEmailToken, issueMagicLink, page, redirect, retryPage, safeNext,
  securityPage } from './shared'

import type { Hono } from 'hono'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from '../bio-body'
import {
  AccountApiKey,
  AccountApiKeyCreate,
  AccountMagicLink,
  AccountPassword,
  ChangeAppearance,
  ConfirmAccountDelete,
  ConfirmEmail,
  NotificationSettings,
  Profile,
} from '../components/pages'
import { exportUserData } from '../data-export'
import { db } from '../db'
import { DENSITY_CHOICES, type DensityChoice, deviceDensity, devicePageSize, PAGE_SIZE_CHOICES, type PageSizeChoice,
  saveDeviceDensity, saveDevicePageSize } from '../device-settings'
import { sendAccountDeletionConfirmation, sendEmailChangeAuthorization, sendPasswordEnableConfirmation } from '../email'
import { emailChangeForToken, issueEmailChangeAuthorization } from '../email-change-authorization'
import { confirmEmailToken, findEmailToken } from '../email-verification'
import { updateProfileHandle } from '../handles'
import {
  clearSessionCookie,
  notificationDevice,
  notificationDeviceCookie,
  notificationUserAgent,
} from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { normalizeSearchQuery, searchPeople, searchTags } from '../search'
import type { PostingSuggestionSearch } from '../components/page-shared'
import { accountForPasswordEnableToken, issuePasswordEnableToken } from '../password-enable'
import { vapidPublicKey } from '../push'
import { sessionHash } from '../sessions'
import { ACCENT_CHOICES, type AccentChoice, appearance, appearanceCookie, FONT_CHOICES, FONT_SIZE_CHOICES,
  type FontChoice, fontChoice, fontCookie, type FontSizeChoice, fontSizeChoice, fontSizeCookie, THEME_CHOICES,
  type ThemeChoice } from '../theme'

function profileSuggestionSearch(fields: Record<string, string>, viewerId: number): PostingSuggestionSearch | null {
  if (fields.action !== 'search-hashtags' && fields.action !== 'search-mentions') return null
  const kind = fields.action === 'search-hashtags' ? 'hashtags' : 'mentions'
  const value = kind === 'hashtags' ? fields.hashtag_query : fields.mention_query
  const query = normalizeSearchQuery(normalizeSearchQuery(value).replace(kind === 'hashtags' ? /^#+\s*/u : /^@+\s*/u, ''))
  const result = kind === 'hashtags'
    ? searchTags(db, query, viewerId, 1, { followedFirst: true })
    : searchPeople(db, query, viewerId, 1, { followedFirst: true, handleOnly: true })
  const results = kind === 'hashtags'
    ? result.rows.map(row => 'tag' in row ? row.tag : '')
    : result.rows.map(row => 'handle' in row ? row.handle : '')
  return { kind, query, results, truncated: result.total > 20 }
}

export function registerAccountRoutes(app: Hono) {
  app.get('/account/edit/notifications', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/notifications'))
    const ios = /(?:iPhone|iPad|iPod)/i.test(c.req.header('user-agent') || '')
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<NotificationSettings user={user} publicKey={vapidPublicKey()} ios={ios} returnPath={returnPath} />)
  })

  app.get('/account/push-subscription', c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const endpoint = c.req.query('endpoint') || ''
    const preferences = endpoint
      ? db.query(`SELECT notify_latest latest,notify_replies replies,notify_mentions mentions,notify_follows follows,
          notify_own_posts ownPosts,notify_follow_activity followActivity,notify_following_notes followingNotes${
        isAdmin(user) ? ',notify_signups signups' : ''
      }
        FROM push_subscriptions WHERE endpoint=? AND user_id=?`).get(endpoint, user.id) as Record<string, number> | null
      : null
    return c.json({ preferences: preferences || {
      latest: 1,
      followingNotes: 1,
      replies: 1,
      mentions: 1,
      follows: 1,
      ownPosts: 1,
      followActivity: 1,
      ...(isAdmin(user) ? { signups: 1 } : {}),
    } })
  })

  app.post('/account/push-subscription', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    let subscription: unknown
    try {
      subscription = await c.req.json()
    }
    catch {
      return c.json({ error: 'Invalid subscription' }, 400)
    }
    const value = subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown };
      preferences?: Record<string, unknown> }
    const endpoint = typeof value?.endpoint === 'string' ? value.endpoint : ''
    const p256dh = typeof value?.keys?.p256dh === 'string' ? value.keys.p256dh : ''
    const auth = typeof value?.keys?.auth === 'string' ? value.keys.auth : ''
    if (!endpoint.startsWith('https://') || endpoint.length > 2048 || !p256dh || p256dh.length > 256
      || !auth || auth.length > 256) return c.json({ error: 'Invalid subscription' }, 400)
    const preference = (name: string) =>
      value.preferences && typeof value.preferences[name] === 'boolean'
        ? Number(value.preferences[name])
        : null
    const latest = preference('latest')
    const replies = preference('replies')
    const mentions = preference('mentions')
    const follows = preference('follows')
    const ownPosts = preference('ownPosts')
    const followActivity = preference('followActivity')
    const followingNotes = preference('followingNotes')
    const signups = isAdmin(user) ? preference('signups') : null
    const deviceId = notificationDevice(c.req.raw) || token()
    db.query(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,device_id,
        notify_latest,notify_replies,notify_mentions,notify_follows,notify_own_posts,notify_signups,
        notify_follow_activity,notify_following_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
        device_id=excluded.device_id,
        notify_latest=coalesce(?,push_subscriptions.notify_latest),
        notify_replies=coalesce(?,push_subscriptions.notify_replies),
        notify_mentions=coalesce(?,push_subscriptions.notify_mentions),
        notify_follows=coalesce(?,push_subscriptions.notify_follows),
        notify_own_posts=coalesce(?,push_subscriptions.notify_own_posts),
        notify_signups=coalesce(?,push_subscriptions.notify_signups),
        notify_follow_activity=coalesce(?,push_subscriptions.notify_follow_activity),
        notify_following_notes=coalesce(?,push_subscriptions.notify_following_notes)`)
      .run(endpoint, user.id, p256dh, auth, deviceId, latest ?? 1, replies ?? 1, mentions ?? 1, follows ?? 1,
        ownPosts ?? 1, signups ?? 1, followActivity ?? 1, followingNotes ?? 1, latest, replies, mentions, follows,
        ownPosts, signups, followActivity, followingNotes)
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'enabled')
        ON CONFLICT(user_id,user_agent) DO UPDATE SET status='enabled',updated_at=CURRENT_TIMESTAMP`)
        .run(user.id, userAgent)
    }
    c.header('Set-Cookie', notificationDeviceCookie(deviceId), { append: true })
    return c.json({ saved: true })
  })

  app.delete('/account/push-subscription', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    let value: { endpoint?: unknown }
    try {
      value = await c.req.json()
    }
    catch {
      return c.json({ error: 'Invalid subscription' }, 400)
    }
    if (typeof value.endpoint !== 'string') return c.json({ error: 'Invalid subscription' }, 400)
    db.query('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(value.endpoint, user.id)
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`DELETE FROM notification_user_agents
        WHERE user_id=? AND user_agent=? AND status='enabled'`).run(user.id, userAgent)
    }
    return c.json({ removed: true })
  })

  app.get('/account/edit', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit'))
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<Profile user={user} profile={user} posts={[]} following={false} editing returnPath={returnPath} />)
  })

  app.post('/account/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    // Preserve whitespace because spaces and line breaks can be meaningful in ASCII art.
    // Treat an entirely blank submission as an empty bio, though.
    const submittedBio = normalizeBioBody(f.bio || '')
    const bio = submittedBio.trim() ? submittedBio : ''
    const submittedHandle = f.handle || ''
    const suggestionSearch = profileSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={submittedHandle}
          editing returnPath={returnPath} suggestionSearch={suggestionSearch} />,
      )
    }
    const handle = submittedHandle.toLowerCase().replace(/^@/, '')
    const validHandle = /^[a-z0-9_]{2,24}$/.test(handle)
    if (!validHandle || !validBioBody(bio)) {
      const handleCharacters = Array.from(submittedHandle).length
      const error = [
        !validHandle
          ? `You typed ${handleCharacters} ${handleCharacters === 1 ? 'character' : 'characters'}. Use 2–24 letters, numbers, or underscores.`
          : '',
        !validBioBody(bio) ? bioBodyValidationMessage(bio) : '',
      ].filter(Boolean).join(' ')
      return page(
        <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={submittedHandle} editing
          error={error} returnPath={returnPath} />,
        400,
      )
    }
    if (handle || bio) {
      const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
      if (!moderation.ok) {
        return page(
          <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={submittedHandle}
            editing error={moderationMessage(moderation.reason)} returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
    }
    try {
      updateProfileHandle(db, user.id, handle, bio)
    }
    catch {
      return page(
        <Profile user={user} profile={user} posts={[]} following={false} bio={bio} editHandle={submittedHandle} editing
          error="That username is unavailable." returnPath={returnPath} />,
        400,
      )
    }
    return redirect('/u/' + handle)
  })

  app.get('/account/edit/appearance', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/appearance'))
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const requestedTab = c.req.query('tab')
    const tab = requestedTab === 'font' || requestedTab === 'misc' ? requestedTab : 'theme'
    return page(<ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
      selectedSize={fontSizeChoice(c.req.raw)} selectedPageSize={devicePageSize(c.req.raw, user.id)} tab={tab}
      selectedDensity={deviceDensity(c.req.raw, user.id)} returnPath={returnPath} />)
  })

  app.post('/account/edit/appearance', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const tab = f.tab === 'font' || f.tab === 'misc' ? f.tab : 'theme'
    const query = `?tab=${tab}${
      returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
    if (tab === 'misc') {
      const selectedPageSize = Number(f.pageSize) as PageSizeChoice
      const selectedDensity = f.density as DensityChoice
      if (!PAGE_SIZE_CHOICES.includes(selectedPageSize) || !DENSITY_CHOICES.includes(selectedDensity)) {
        return page(<ChangeAppearance user={user} selected={appearance(c.req.raw)}
          selectedFont={fontChoice(c.req.raw)} selectedSize={fontSizeChoice(c.req.raw)}
          selectedPageSize={devicePageSize(c.req.raw, user.id)} selectedDensity={deviceDensity(c.req.raw, user.id)}
          tab="misc" returnPath={returnPath} />, 400)
      }
      const deviceId = notificationDevice(c.req.raw) || token()
      saveDevicePageSize(user.id, deviceId, selectedPageSize)
      saveDeviceDensity(user.id, deviceId, selectedDensity)
      return redirect('/account/edit/appearance' + query, notificationDeviceCookie(deviceId))
    }
    if (tab === 'font') {
      const selected = f.font as FontChoice
      const selectedSize = f.fontSize as FontSizeChoice
      if (!FONT_CHOICES.some(font => font.value === selected)
        || !FONT_SIZE_CHOICES.some(size => size.value === selectedSize)) {
        return page(<ChangeAppearance user={user} selected={appearance(c.req.raw)}
          selectedFont={fontChoice(c.req.raw)} selectedSize={fontSizeChoice(c.req.raw)} tab="font"
          selectedPageSize={devicePageSize(c.req.raw, user.id)} selectedDensity={deviceDensity(c.req.raw, user.id)}
          returnPath={returnPath} />, 400)
      }
      const response = redirect('/account/edit/appearance' + query, fontCookie(selected))
      response.headers.append('set-cookie', fontSizeCookie(selectedSize))
      return response
    }
    const theme = f.theme as ThemeChoice
    const accent = f.accent as AccentChoice
    if (!THEME_CHOICES.includes(theme) || !ACCENT_CHOICES.includes(accent)) {
      return page(<ChangeAppearance user={user} selected={appearance(c.req.raw)}
        selectedFont={fontChoice(c.req.raw)} selectedSize={fontSizeChoice(c.req.raw)} tab="theme"
        selectedPageSize={devicePageSize(c.req.raw, user.id)} selectedDensity={deviceDensity(c.req.raw, user.id)}
        returnPath={returnPath} />, 400)
    }
    return redirect('/account/edit/appearance' + query, appearanceCookie({ theme, accent }))
  })

  app.get('/account/edit/theme', c => {
    const from = c.req.query('from')
    return redirect('/account/edit/appearance?tab=theme' + (from ? '&from=' + encodeURIComponent(safeNext(from)) : ''))
  })

  app.get('/account/edit/font', c => {
    const from = c.req.query('from')
    return redirect('/account/edit/appearance?tab=font' + (from ? '&from=' + encodeURIComponent(safeNext(from)) : ''))
  })

  app.get('/account/security', c => {
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return securityPage(c.req.raw, undefined, c.req.query('enabled') === 'password'
      ? 'Password login enabled.'
      : c.req.query('changed') === 'password'
      ? 'Password changed. Other sessions were revoked.'
      : c.req.query('changed') === 'email'
      ? 'Email address verified and changed.'
      : c.req.query('verified') === '1'
      ? 'Email address verified.'
      : undefined, 200, returnPath)
  })

  app.get('/account/api-keys/new', c => {
    const user = currentUser(c.req.raw)
    return user
      ? page(<AccountApiKeyCreate user={user} />)
      : redirect('/enter?next=' + encodeURIComponent('/account/api-keys/new'))
  })

  app.post('/account/api-keys', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = authLimit(c, 'api-key-create', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(page(<AccountApiKeyCreate user={user} error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter)
    }
    const f = await form(c.req.raw)
    const name = (f.name || '').trim()
    const lifetimes: Record<string, number | null> = {
      '90-days': 90 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
      never: null,
    }
    if (!name || name.length > 64 || !Object.hasOwn(lifetimes, f.lifetime)) {
      return page(
        <AccountApiKeyCreate user={user} name={name} lifetime={f.lifetime}
          error="Enter a key name and choose a valid expiration." />,
        400,
      )
    }
    const count = (db.query(`SELECT count(*) count FROM api_keys
      WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)`)
      .get(user.id, Date.now()) as { count: number }).count
    if (count >= 20) {
      return page(
        <AccountApiKeyCreate user={user} name={name} lifetime={f.lifetime}
          error="Revoke an existing key before creating another." />,
        400,
      )
    }
    const lifetime = lifetimes[f.lifetime]
    const issued = issueApiKey(db, user.id, name, lifetime === null ? null : Date.now() + lifetime)
    return page(<AccountApiKey user={user} name={name} value={issued.value} />)
  })

  app.post('/account/api-keys/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (/^\d+$/.test(f.id || '')) db.query('DELETE FROM api_keys WHERE id=? AND user_id=?').run(Number(f.id), user.id)
    return redirect('/account/security')
  })

  app.get('/account/password/enable', c => {
    const user = currentUser(c.req.raw)
    const value = c.req.query('token') || ''
    if (value) {
      return accountForPasswordEnableToken(db, value)
        ? page(<AccountPassword user={user} enabled={false} token={value} />)
        : page(<AccountPassword user={user} enabled={false} invalid />, 400)
    }
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/password/enable'))
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    return credentials.password === '!'
      ? page(<AccountPassword user={user} enabled={false} request />)
      : redirect('/account/password/change')
  })
  app.post('/account/password/enable', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const limited = authLimit(c, 'password-enable', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(
        page(
          <AccountPassword user={user} enabled={false} request={!f.token} token={f.token || undefined}
            error={authRateLimitMessage(limited.retryAfter)} />,
          429,
        ),
        limited.retryAfter,
      )
    }
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
        return page(
          <AccountPassword user={user} enabled={false} request
            error="Setup email could not be sent. Please try again later." />,
          503,
        )
      }
      return page(<AccountPassword user={user} enabled={false} sent />)
    }
    if (!tokenAccount) return page(<AccountPassword user={user} enabled={false} invalid />, 400)
    const password = f.newPassword || ''
    if (password.length < 8 || password.length > 128) {
      return page(
        <AccountPassword user={user} enabled={false} token={f.token}
          error="Use a password between 8 and 128 characters." />,
        400,
      )
    }
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
    return credentials.password === '!'
      ? redirect('/account/password/enable')
      : page(<AccountPassword user={user} enabled />)
  })
  app.post('/account/password/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = authLimit(c, 'password-change', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(
        page(<AccountPassword user={user} enabled error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter,
      )
    }
    const f = await form(c.req.raw)
    const oldPassword = f.oldPassword || ''
    const newPassword = f.newPassword || ''
    const credentials = db.query('SELECT password FROM users WHERE id=?').get(user.id) as { password: string }
    if (credentials.password === '!') return redirect('/account/password/enable')
    if (!await verifyPassword(oldPassword, credentials.password)) {
      return page(<AccountPassword user={user} enabled error="Old password is incorrect." />, 400)
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return page(<AccountPassword user={user} enabled error="Use a password between 8 and 128 characters." />, 400)
    }
    if (oldPassword === newPassword) {
      return page(<AccountPassword user={user} enabled error="Choose a password different from your old password." />,
        400)
    }
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
    return change
      ? page(<ConfirmEmail token={value} kind="authorize-change" email={change.new_email} />)
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
      return page(
        <ConfirmEmail token={value} kind="authorize-change" email={change.new_email}
          error="Confirmation email could not be sent. Please try again later." />,
        503,
      )
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
    if (limited) {
      return retryPage(
        page(
          <ConfirmAccountDelete user={user} passwordEnabled={passwordEnabled}
            error={authRateLimitMessage(limited.retryAfter)} />,
          429,
        ),
        limited.retryAfter,
      )
    }
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
      await sendAccountDeletionConfirmation(user.email, `${origin}/account/delete?token=${encodeURIComponent(value)}`)
    }
    catch (error) {
      db.query('DELETE FROM account_deletion_tokens WHERE token_hash=?').run(hash(value))
      console.error('Could not send account-deletion confirmation', error)
      return page(
        <ConfirmAccountDelete user={user} error="Confirmation email could not be sent. Please try again later." />,
        503,
      )
    }
    return page(<ConfirmAccountDelete user={user} sent />)
  })
}
