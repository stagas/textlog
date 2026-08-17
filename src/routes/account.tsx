import { accountForDeletionToken, issueAccountDeletionToken } from '../account-deletion'
import { accountChoices, accountGroupForUser, isPrimaryAccount, selectAccount } from '../account-groups'
import { accountForEmail } from '../account-groups'
import { anonymizeUser, isAdmin } from '../admin'
import { issueApiKey } from '../api-keys'
import { apiOrigin } from '../api'
import { issueFeedKey } from '../feed-keys'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { currentUser, hash, hashPassword, sessionToken, token, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, issueEmailToken, issueMagicLink, page, redirect, retryPage, safeNext,
  securityPage, INVITATION_LINK_LIFETIME_MS } from './shared'

import type { Hono } from 'hono'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from '../bio-body'
import type { PostingSuggestionSearch } from '../components/page-shared'
import {
  AccountApiKey,
  AccountApiKeyCreate,
  AccountFeedKey,
  AccountFeedKeyCreate,
  AccountMagicLink,
  AccountPassword,
  AccountSwitcher,
  ChangeAppearance,
  ConfirmAccountDelete,
  ConfirmEmail,
  InviteFriends,
  NotificationSettings,
  Profile,
} from '../components/pages'
import { exportUserData } from '../data-export'
import { db } from '../db'
import { DENSITY_CHOICES, type DensityChoice, deviceDensity, devicePageSize, PAGE_SIZE_CHOICES, type PageSizeChoice,
  saveDeviceDensity, saveDevicePageSize } from '../device-settings'
import { sendAccountDeletionConfirmation, sendEmailChangeAuthorization, sendFriendInvitation,
  sendPasswordEnableConfirmation } from '../email'
import { emailPattern } from './auth'
import { emailChangeForToken, issueEmailChangeAuthorization } from '../email-change-authorization'
import { confirmEmailToken, findEmailToken } from '../email-verification'
import { updateProfileHandle } from '../handles'
import { invalidateMaterializedFeedPages } from '../materialized-feed-pages'
import {
  clearSessionCookie,
  notificationDevice,
  notificationDeviceCookie,
  notificationUserAgent,
} from '../http'
import { moderateText, moderationMessage } from '../moderation'
import { accountForPasswordEnableToken, issuePasswordEnableToken } from '../password-enable'
import { vapidPublicKey } from '../push'
import { normalizeSearchQuery, searchPeople, searchTags } from '../search'
import { deleteBioLinkPreviewImages, deleteLinkPreviewImages, discoverLinkPreviews,
  replaceBioLinkPreviews } from '../link-preview'
import { sessionHash } from '../sessions'
import { ACCENT_CHOICES, type AccentChoice, appearance, appearanceCookie, FONT_CHOICES, FONT_SIZE_CHOICES,
  type FontChoice, fontChoice, fontCookie, type FontSizeChoice, fontSizeChoice, fontSizeCookie, PRIMARY_FONT_CHOICES,
  type PrimaryFontChoice, primaryFontChoice, primaryFontCookie, SANS_SERIF_FONT_CHOICES, type SansSerifFontChoice,
  sansSerifFontChoice, sansSerifFontCookie, THEME_CHOICES, type ThemeChoice } from '../theme'
import { DEFAULT_TIMEZONE, validTimezone } from '../timezone'

function markAppearanceBannerHandled(request: Request, userId: number) {
  const userAgent = notificationUserAgent(request)
  if (!userAgent) return
  db.query(`INSERT INTO appearance_user_agents(user_id,user_agent,status) VALUES(?,?,'seen')
    ON CONFLICT(user_id,user_agent) DO UPDATE SET status='seen',updated_at=CURRENT_TIMESTAMP`)
    .run(userId, userAgent)
}

function markInviteBannerHandled(userId: number) {
  db.query(`INSERT INTO invite_banner_dismissals(user_id) VALUES(?)
    ON CONFLICT(user_id) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`).run(userId)
}

function profileSuggestionSearch(fields: Record<string, string>, viewerId: number): PostingSuggestionSearch | null {
  if (fields.action !== 'search-hashtags' && fields.action !== 'search-mentions') return null
  const kind = fields.action === 'search-hashtags' ? 'hashtags' : 'mentions'
  const value = kind === 'hashtags' ? fields.hashtag_query : fields.mention_query
  const query = normalizeSearchQuery(
    normalizeSearchQuery(value).replace(kind === 'hashtags' ? /^#+\s*/u : /^@+\s*/u, ''),
  )
  const result = kind === 'hashtags'
    ? searchTags(db, query, viewerId, 1, { followedFirst: true })
    : searchPeople(db, query, viewerId, 1, { followedFirst: true, handleOnly: true })
  const results = kind === 'hashtags'
    ? result.rows.map(row => 'tag' in row ? row.tag : '')
    : result.rows.map(row => 'handle' in row ? row.handle : '')
  return { kind, query, results, truncated: result.total > 20 }
}

export function registerAccountRoutes(app: Hono) {
  app.get('/account/edit/invite', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/invite'))
    markInviteBannerHandled(user.id)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<InviteFriends user={user} returnPath={returnPath} />)
  })

  app.post('/account/edit/invite', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/invite'))
    const f = await form(c.req.raw, 8_000)
    const submitted = f.emails || ''
    const returnPath = f.from ? safeNext(f.from) : undefined
    const emails = [...new Set(submitted.split(/[\s,]+/u).map(value => value.trim().toLowerCase()).filter(Boolean))]
    const renderError = (error: string, status = 400) =>
      page(<InviteFriends user={user} emails={submitted} error={error} returnPath={returnPath} />, status)
    if (!emails.length) return renderError('Enter at least one email address.')
    if (emails.length > 20) return renderError('You can invite up to 20 friends at a time.')
    if (emails.some(email => email.length > 254 || !emailPattern.test(email))) {
      return renderError('Check the email addresses and try again. Separate each address with a space or comma.')
    }
    const limited = authLimit(c, 'friend-invite-user', String(user.id), { attempts: 5, windowSeconds: 60 * 60 })
    if (limited) {
      return retryPage(renderError(authRateLimitMessage(limited.retryAfter), 429), limited.retryAfter)
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    try {
      for (const email of emails) {
        const account = accountForEmail(db, email)
        const link = issueMagicLink(email, account?.id ?? null, '/', origin, db, INVITATION_LINK_LIFETIME_MS)
        try {
          await sendFriendInvitation(email, link.url, user.handle)
        }
        catch (error) {
          const value = new URL(link.url).searchParams.get('token') || ''
          db.query('DELETE FROM magic_links WHERE token_hash=?').run(hash(value))
          throw error
        }
      }
    }
    catch (error) {
      console.error('Could not send friend invitations', error)
      return renderError('The invitations could not all be sent. Please try again later.', 503)
    }
    return page(<InviteFriends user={user} sent={emails.length} returnPath={returnPath} />)
  })

  app.get('/account/accounts', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/accounts'))
    return page(<AccountSwitcher user={user} accounts={accountChoices(db, user.id)} />)
  })

  app.post('/account/accounts/select', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (!/^\d+$/.test(f.accountId || '')) return redirect('/account/accounts')
    const targetId = Number(f.accountId)
    const group = accountGroupForUser(db, user.id)
    const target = group && db.query(`SELECT id,handle,handle_chosen_at FROM users
      WHERE id=? AND account_group_id=? AND deleted_at IS NULL AND suspended_at IS NULL`)
      .get(targetId, group.id) as { id: number; handle: string; handle_chosen_at: string | null } | null
    if (!target) return redirect('/account/accounts')
    db.transaction(() => {
      if (!selectAccount(db, target.id)) throw new Error('Account is unavailable')
      db.query('UPDATE sessions SET user_id=? WHERE token_hash=? AND user_id=?')
        .run(target.id, sessionHash(sessionToken(c.req.raw)), user.id)
    })()
    return redirect(target.handle_chosen_at ? '/account/edit' : '/choose-handle?next=%2Faccount%2Faccounts')
  })

  app.post('/account/accounts/new', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const group = accountGroupForUser(db, user.id)
    if (!group) return redirect('/account/accounts')
    let newUserId: number | null = null
    db.transaction(() => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const handle = `anon${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
          const created = db.query(`INSERT INTO users(handle,email,password,email_verified_at,account_group_id)
            VALUES(?,?,'!',CURRENT_TIMESTAMP,?) RETURNING id`).get(handle, group.email, group.id) as { id: number }
          newUserId = created.id
          break
        }
        catch {}
      }
      if (!newUserId || !selectAccount(db, newUserId)) throw new Error('Could not create account')
      db.query('UPDATE sessions SET user_id=? WHERE token_hash=? AND user_id=?')
        .run(newUserId, sessionHash(sessionToken(c.req.raw)), user.id)
    })()
    return redirect('/choose-handle?next=%2Faccount%2Faccounts')
  })

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
          notify_follow_activity followActivity,notify_following_notes followingNotes,
          notify_bots bots,notify_following_only_to_me followingOnlyToMe${
        isAdmin(user) ? ',notify_signups signups' : ''
      }
        FROM push_subscriptions WHERE endpoint=? AND user_id=?`).get(endpoint, user.id) as Record<string, number> | null
      : null
    return c.json({ enabled: Boolean(preferences), preferences: preferences || {
      latest: 1,
      followingNotes: 1,
      bots: 0,
      followingOnlyToMe: 0,
      replies: 1,
      mentions: 1,
      follows: 1,
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
    const followActivity = preference('followActivity')
    const followingNotes = preference('followingNotes')
    const bots = preference('bots')
    const followingOnlyToMe = preference('followingOnlyToMe')
    const signups = isAdmin(user) ? preference('signups') : null
    const deviceId = notificationDevice(c.req.raw) || token()
    db.transaction(() => {
      // Push services may rotate credentials without changing the endpoint. Keep every
      // account attached to this physical browser on the current credential pair.
      db.query('UPDATE push_subscriptions SET p256dh=?,auth=?,device_id=? WHERE endpoint=?')
        .run(p256dh, auth, deviceId, endpoint)
      db.query(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,device_id,
          notify_latest,notify_replies,notify_mentions,notify_follows,notify_own_posts,notify_signups,
          notify_follow_activity,notify_following_notes,notify_bots,notify_following_only_to_me)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(endpoint,user_id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
          device_id=excluded.device_id,
          notify_latest=coalesce(?,push_subscriptions.notify_latest),
          notify_replies=coalesce(?,push_subscriptions.notify_replies),
          notify_mentions=coalesce(?,push_subscriptions.notify_mentions),
          notify_follows=coalesce(?,push_subscriptions.notify_follows),
          notify_own_posts=0,
          notify_signups=coalesce(?,push_subscriptions.notify_signups),
          notify_follow_activity=coalesce(?,push_subscriptions.notify_follow_activity),
          notify_following_notes=coalesce(?,push_subscriptions.notify_following_notes),
          notify_bots=coalesce(?,push_subscriptions.notify_bots),
          notify_following_only_to_me=coalesce(?,push_subscriptions.notify_following_only_to_me)`)
        .run(endpoint, user.id, p256dh, auth, deviceId, latest ?? 1, replies ?? 1, mentions ?? 1, follows ?? 1,
          0, signups ?? 1, followActivity ?? 1, followingNotes ?? 1, bots ?? 0, followingOnlyToMe ?? 0,
          latest, replies, mentions, follows, signups, followActivity, followingNotes, bots, followingOnlyToMe)
    })()
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'enabled')
        ON CONFLICT(user_id,user_agent) DO UPDATE SET status='enabled',updated_at=CURRENT_TIMESTAMP`)
        .run(user.id, userAgent)
      if (value.preferences) {
        db.query(`INSERT INTO notification_improvement_user_agents(user_id,user_agent) VALUES(?,?)
          ON CONFLICT(user_id,user_agent) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`)
          .run(user.id, userAgent)
      }
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
    const active = !!db.query('SELECT 1 FROM push_subscriptions WHERE endpoint=? LIMIT 1').get(value.endpoint)
    const userAgent = notificationUserAgent(c.req.raw)
    if (userAgent) {
      db.query(`DELETE FROM notification_user_agents
        WHERE user_id=? AND user_agent=? AND status='enabled'`).run(user.id, userAgent)
    }
    return c.json({ removed: true, active })
  })

  app.get('/account/edit', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit'))
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const bot = db.query('SELECT is_bot,bot_managed,timezone FROM users WHERE id=?').get(user.id) as {
      is_bot: number
      bot_managed: number
      timezone: string
    }
    return page(<Profile user={user} profile={{ ...user, ...bot }} posts={[]} following={false} editing
      returnPath={returnPath} />)
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
    const submittedTimezone = f.timezone || user.timezone || DEFAULT_TIMEZONE
    const isBot = f.isBot === 'yes'
    const suggestionSearch = profileSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editing
          returnPath={returnPath} suggestionSearch={suggestionSearch} editIsBot={isBot} />,
      )
    }
    const handle = submittedHandle.toLowerCase().replace(/^@/, '')
    const validHandle = /^[a-z0-9_]{2,24}$/.test(handle)
    if (!validHandle || !validBioBody(bio) || !validTimezone(submittedTimezone)) {
      const handleCharacters = Array.from(submittedHandle).length
      const error = [
        !validHandle
          ? `You typed ${handleCharacters} ${
            handleCharacters === 1 ? 'character' : 'characters'
          }. Use 2–24 letters, numbers, or underscores.`
          : '',
        !validBioBody(bio) ? bioBodyValidationMessage(bio) : '',
        !validTimezone(submittedTimezone) ? 'Choose a valid timezone.' : '',
      ].filter(Boolean).join(' ')
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editing
          error={error} returnPath={returnPath} editIsBot={isBot} />,
        400,
      )
    }
    if (handle || bio) {
      const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
      if (!moderation.ok) {
        return page(
          <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
            editHandle={submittedHandle}
            editing error={moderationMessage(moderation.reason)} returnPath={returnPath} editIsBot={isBot} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
    }
    try {
      updateProfileHandle(db, user.id, handle, bio)
      await replaceBioLinkPreviews(db, user.id, await discoverLinkPreviews(bio, db))
      db.query('UPDATE users SET timezone=? WHERE id=?').run(submittedTimezone, user.id)
      db.query('UPDATE users SET is_bot=? WHERE id=? AND bot_managed=0').run(isBot ? 1 : 0, user.id)
      invalidateMaterializedFeedPages(user.id, ['latest', 'hot', 'for-you', 'to-me'])
    }
    catch {
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editing
          error="That username is unavailable." returnPath={returnPath} editIsBot={isBot} />,
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
    return page(
      <ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
        selectedSansSerifFont={sansSerifFontChoice(c.req.raw)} selectedPrimaryFont={primaryFontChoice(c.req.raw)}
        selectedSize={fontSizeChoice(c.req.raw)} selectedPageSize={devicePageSize(c.req.raw, user.id)} tab={tab}
        selectedDensity={deviceDensity(c.req.raw, user.id)} selectedLinkPreviews={user.show_link_previews !== 0}
        returnPath={returnPath} />,
    )
  })

  app.post('/account/edit/appearance', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const returnPath = f.from ? safeNext(f.from) : undefined
    const tab = f.tab === 'font' || f.tab === 'misc' ? f.tab : 'theme'
    const query = `?tab=${tab}${returnPath ? '&from=' + encodeURIComponent(returnPath) : ''}`
    if (tab === 'misc') {
      const selectedPageSize = Number(f.pageSize) as PageSizeChoice
      const selectedDensity = f.density as DensityChoice
      if (!PAGE_SIZE_CHOICES.includes(selectedPageSize) || !DENSITY_CHOICES.includes(selectedDensity)) {
        return page(
          <ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
            selectedSize={fontSizeChoice(c.req.raw)} selectedPageSize={devicePageSize(c.req.raw, user.id)}
            selectedDensity={deviceDensity(c.req.raw, user.id)} tab="misc" returnPath={returnPath} />,
          400,
        )
      }
      const deviceId = notificationDevice(c.req.raw) || token()
      saveDevicePageSize(user.id, deviceId, selectedPageSize)
      saveDeviceDensity(user.id, deviceId, selectedDensity)
      db.query('UPDATE users SET show_link_previews=? WHERE id=?').run(f.showLinkPreviews === 'yes' ? 1 : 0, user.id)
      markAppearanceBannerHandled(c.req.raw, user.id)
      return redirect('/account/edit/appearance' + query, notificationDeviceCookie(deviceId))
    }
    if (tab === 'font') {
      const selected = f.font as FontChoice
      const selectedSansSerif = f.sansSerifFont as SansSerifFontChoice
      const selectedPrimary = f.primaryFont as PrimaryFontChoice
      const selectedSize = f.fontSize as FontSizeChoice
      if (!FONT_CHOICES.some(font => font.value === selected)
        || !SANS_SERIF_FONT_CHOICES.some(font => font.value === selectedSansSerif)
        || !PRIMARY_FONT_CHOICES.includes(selectedPrimary)
        || !FONT_SIZE_CHOICES.some(size => size.value === selectedSize))
      {
        return page(
          <ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
            selectedSize={fontSizeChoice(c.req.raw)} tab="font" selectedPageSize={devicePageSize(c.req.raw, user.id)}
            selectedDensity={deviceDensity(c.req.raw, user.id)} returnPath={returnPath} />,
          400,
        )
      }
      const response = redirect('/account/edit/appearance' + query, fontCookie(selected))
      response.headers.append('set-cookie', sansSerifFontCookie(selectedSansSerif))
      response.headers.append('set-cookie', primaryFontCookie(selectedPrimary))
      response.headers.append('set-cookie', fontSizeCookie(selectedSize))
      markAppearanceBannerHandled(c.req.raw, user.id)
      return response
    }
    const theme = f.theme as ThemeChoice
    const accent = f.accent as AccentChoice
    if (!THEME_CHOICES.includes(theme) || !ACCENT_CHOICES.includes(accent)) {
      return page(
        <ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
          selectedSize={fontSizeChoice(c.req.raw)} tab="theme" selectedPageSize={devicePageSize(c.req.raw, user.id)}
          selectedDensity={deviceDensity(c.req.raw, user.id)} returnPath={returnPath} />,
        400,
      )
    }
    markAppearanceBannerHandled(c.req.raw, user.id)
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
      : c.req.query('revoked') === 'feed'
      ? 'Feed key revoked. Its RSS and Atom URLs no longer work.'
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

  app.get('/account/feed-keys/new', c => {
    const user = currentUser(c.req.raw)
    return user ? page(<AccountFeedKeyCreate user={user} />)
      : redirect('/enter?next=' + encodeURIComponent('/account/feed-keys/new'))
  })

  app.post('/account/feed-keys', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = authLimit(c, 'feed-key-create', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) return retryPage(securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
      limited.retryAfter)
    const f = await form(c.req.raw)
    const name = (f.name || '').trim()
    const lifetimes: Record<string, number | null> = {
      '90-days': 90 * 24 * 60 * 60 * 1000, year: 365 * 24 * 60 * 60 * 1000, never: null,
    }
    if (!name || name.length > 64 || !Object.hasOwn(lifetimes, f.lifetime)) {
      return page(<AccountFeedKeyCreate user={user} name={name} lifetime={f.lifetime}
        error="Enter a key name and choose a valid expiration." />, 400)
    }
    const count = (db.query(`SELECT count(*) count FROM feed_keys
      WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)`).get(user.id, Date.now()) as { count: number }).count
    if (count >= 20) return page(<AccountFeedKeyCreate user={user} name={name} lifetime={f.lifetime}
      error="Revoke an existing key before creating another." />, 400)
    const lifetime = lifetimes[f.lifetime]
    const issued = issueFeedKey(db, user.id, name, lifetime === null ? null : Date.now() + lifetime)
    const origin = apiOrigin(c.req.url)
    return page(<AccountFeedKey user={user} rssUrl={`${origin}/feeds/for-you/${issued.value}.rss`}
      atomUrl={`${origin}/feeds/for-you/${issued.value}.atom`} />)
  })

  app.post('/account/feed-keys/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (/^\d+$/.test(f.id || '')) db.query('DELETE FROM feed_keys WHERE id=? AND user_id=?').run(Number(f.id), user.id)
    return redirect('/account/security?revoked=feed')
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
    const group = accountGroupForUser(db, user.id)
    if (db.query('SELECT 1 FROM account_groups WHERE email=? AND id!=?').get(email, group?.id ?? -1)
      || db.query(`SELECT 1 FROM users WHERE email=? AND deleted_at IS NULL
        AND (account_group_id IS NULL OR account_group_id!=?)`).get(email, group?.id ?? -1))
    {
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
      if (isAdmin({ email: deletionAccount.email }) && isPrimaryAccount(db, deletionAccount.id)) {
        return c.text('Admin accounts cannot delete themselves', 403)
      }
      const postIds = (db.query('SELECT id FROM posts WHERE user_id=?').all(deletionAccount.id) as { id: number }[])
        .map(post => post.id)
      db.transaction(() => anonymizeUser(db, deletionAccount.id))()
      for (const postId of postIds) await deleteLinkPreviewImages(db, postId)
      await deleteBioLinkPreviewImages(db, deletionAccount.id)
      return redirect('/', clearSessionCookie())
    }
    if (f.token) return page(<ConfirmAccountDelete user={user} invalid />, 400)
    if (!user) return redirect('/enter')
    if (isAdmin(user) && isPrimaryAccount(db, user.id)) return c.text('Admin accounts cannot delete themselves', 403)
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
      const postIds = (db.query('SELECT id FROM posts WHERE user_id=?').all(user.id) as { id: number }[])
        .map(post => post.id)
      db.transaction(() => anonymizeUser(db, user.id))()
      for (const postId of postIds) await deleteLinkPreviewImages(db, postId)
      await deleteBioLinkPreviewImages(db, user.id)
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
