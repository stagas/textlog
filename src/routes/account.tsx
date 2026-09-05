import { accountForDeletionToken, issueAccountDeletionToken } from '../account-deletion'
import { accountGroupForUser, isPrimaryAccount } from '../account-groups'
import { anonymizeUser, isAdmin } from '../admin'
import { AUTH_LIMITS, authRateLimitMessage } from '../auth-rate-limit'
import { currentUser, hash, hashPassword, sessionToken, token, verifyPassword } from '../utils'
import { authLimit, clientAddress, form, INVITATION_LINK_LIFETIME_MS, issueEmailToken, issueMagicLink, page, redirect,
  retryPage, safeNext, securityPage } from './shared'

import type { Hono } from 'hono'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from '../bio-body'
import type { PostingSuggestionSearch } from '../components/page-shared'
import {
  AccountApiKey,
  AccountApiKeyCreate,
  AccountFeedKeyCreate,
  AccountMagicLink,
  AccountPassword,
  AccountSwitcher,
  ChangeAppearance,
  ConfirmAccountDelete,
  ConfirmEmail,
  EmailPreferences,
  InteractedEmails,
  InviteFriends,
  NotificationSettings,
  Profile,
  RecapEmails,
} from '../components/pages'
import { exportUserData } from '../data-export'
import { databaseService } from '../database-service'
import { sendAccountDeletionConfirmation, sendEmailChangeAuthorization, sendFriendInvitation,
  sendPasswordEnableConfirmation } from '../email'
import { emailChangeForToken, issueEmailChangeAuthorization } from '../email-change-authorization'
import { confirmEmailToken, findEmailToken } from '../email-verification'
import { isDevelopment } from '../environment'
import {
  clearSessionCookie,
  exploreWelcomeCookie,
  notificationDevice,
  notificationDeviceCookie,
  notificationUserAgent,
} from '../http'
import { deleteImages, deleteImagesAfterCommit } from '../image-storage'
import { deleteBioLinkPreviewImages, deleteLinkPreviewImages, discoverLinkPreviews } from '../link-preview'
import { moderateText, moderationMessage } from '../moderation'
import { PAGE_SIZE } from '../pagination'
import { accountForPasswordEnableToken, issuePasswordEnableToken } from '../password-enable'
import { vapidPublicKey } from '../push'
import { DENSITY_CHOICES, type DensityChoice, PAGE_SIZE_CHOICES, type PageSizeChoice, resolvedDensity,
  resolvedPageSize } from '../request-preferences'
import { normalizeSearchQuery } from '../search'
import { sessionHash } from '../sessions'
import { ACCENT_CHOICES, type AccentChoice, appearance, appearanceCookie, CORNER_CHOICES, type CornerChoice,
  cornerChoice, cornerCookie, FONT_CHOICES, FONT_SIZE_CHOICES, type FontChoice, fontChoice, fontCookie,
  type FontSizeChoice, fontSizeChoice, fontSizeCookie, PRIMARY_FONT_CHOICES, type PrimaryFontChoice, primaryFontChoice,
  primaryFontCookie, SANS_SERIF_FONT_CHOICES, type SansSerifFontChoice, sansSerifFontChoice, sansSerifFontCookie,
  THEME_CHOICES, type ThemeChoice } from '../theme'
import { DEFAULT_TIMEZONE, validTimezone } from '../timezone'
import { emailPattern } from './auth'

const FRIEND_INVITE_LIMIT = 100
const FRIEND_INVITE_SPACING_MS = 1_000

async function markAppearanceBannerHandled(request: Request, userId: number) {
  const userAgent = notificationUserAgent(request)
  if (!userAgent) return
  await databaseService().call('feeds.recordBanner', { userId, userAgent, action: 'appearance-seen' })
}

async function markInviteBannerHandled(userId: number) {
  await databaseService().call('feeds.recordBanner', { userId, userAgent: null, action: 'invite-dismissed' })
}

async function profileSuggestionSearch(fields: Record<string, string>,
  viewerId: number): Promise<PostingSuggestionSearch | null>
{
  if (fields.action !== 'search-hashtags' && fields.action !== 'search-mentions') return null
  const kind = fields.action === 'search-hashtags' ? 'hashtags' : 'mentions'
  const value = kind === 'hashtags' ? fields.hashtag_query : fields.mention_query
  const query = normalizeSearchQuery(
    normalizeSearchQuery(value).replace(kind === 'hashtags' ? /^#+\s*/u : /^@+\s*/u, ''),
  )
  const result = await databaseService().call('posts.suggestions', { kind, query, viewerId })
  return { kind, query, ...result }
}

export function registerAccountRoutes(app: Hono) {
  app.get('/account/edit/invite', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/invite'))
    await markInviteBannerHandled(user.id)
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<InviteFriends user={user} returnPath={returnPath} />)
  })

  app.post('/account/edit/invite', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/invite'))
    const f = await form(c.req.raw, 32_000)
    const submitted = f.emails || ''
    const returnPath = f.from ? safeNext(f.from) : undefined
    const emails = [...new Set(submitted.split(/[\s,]+/u).map(value => value.trim().toLowerCase()).filter(Boolean))]
    const renderError = (error: string, status = 400) =>
      page(<InviteFriends user={user} emails={submitted} error={error} returnPath={returnPath} />, status)
    if (!emails.length) return renderError('Enter at least one email address.')
    if (emails.length > FRIEND_INVITE_LIMIT) {
      return renderError('The invitations could not be sent. Check the addresses and try again.')
    }
    if (emails.some(email => email.length > 254 || !emailPattern.test(email))) {
      return renderError('Check the email addresses and try again. Separate each address with a space or comma.')
    }
    const limited = await authLimit(c, 'friend-invite-user', String(user.id), { attempts: 5, windowSeconds: 60 * 60 })
    if (limited) {
      return retryPage(renderError(authRateLimitMessage(limited.retryAfter), 429), limited.retryAfter)
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    try {
      for (const [index, email] of emails.entries()) {
        if (index > 0) await Bun.sleep(FRIEND_INVITE_SPACING_MS)
        const account = await databaseService().call('auth.accountForIdentifier', { identifier: email, isEmail: true })
        const link = await issueMagicLink(email, account?.id ?? null, '/', origin, INVITATION_LINK_LIFETIME_MS)
        try {
          await sendFriendInvitation(email, link.url, user.handle)
          console.log(`Sent friend invitation to ${email}`)
        }
        catch (error) {
          await databaseService().call('auth.deleteMagicLink', { tokenHash: link.tokenHash })
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

  app.get('/account/accounts', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/accounts'))
    const accounts = await databaseService().call('account.choices', { userId: user.id })
    return page(<AccountSwitcher user={user} accounts={accounts} />)
  })

  app.post('/account/accounts/select', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (!/^\d+$/.test(f.accountId || '')) return redirect('/account/accounts')
    const targetId = Number(f.accountId)
    const selected = await databaseService().call('account.select', {
      userId: user.id,
      targetId,
      sessionHash: sessionHash(sessionToken(c.req.raw)) || '',
    })
    if (selected.status === 'not_found') return redirect('/account/accounts')
    return redirect(selected.handleChosen ? safeNext(f.next) : '/choose-handle?next=%2Faccount%2Faccounts')
  })

  app.post('/account/accounts/new', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const created = await databaseService().call('account.createLinked', {
      userId: user.id,
      sessionHash: sessionHash(sessionToken(c.req.raw)) || '',
    })
    if (!created) return redirect('/account/accounts')
    return redirect('/choose-handle?next=%2Faccount%2Faccounts')
  })

  app.get('/account/edit/notifications', c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit/notifications'))
    const ios = /(?:iPhone|iPad|iPod)/i.test(c.req.header('user-agent') || '')
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    return page(<NotificationSettings user={user} publicKey={vapidPublicKey()} ios={ios} returnPath={returnPath} />)
  })

  app.get('/account/push-subscription', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const endpoint = c.req.query('endpoint') || ''
    const preferences = await databaseService().call('account.pushPreferences', {
      userId: user.id,
      endpoint,
      includeSignups: isAdmin(user),
    })
    return c.json({ enabled: Boolean(preferences), preferences: preferences || {
      latest: 1,
      followingNotes: 1,
      followingOnlyToMe: 0,
      replies: 1,
      mentions: 1,
      follows: 1,
      followActivity: 1,
      broadcasts: 1,
      peopleFollowActivity: 0,
      hashtagFollowActivity: 0,
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
    const broadcasts = preference('broadcasts')
    const peopleFollowActivity = preference('peopleFollowActivity')
    const hashtagFollowActivity = preference('hashtagFollowActivity')
    const followingNotes = preference('followingNotes')
    const followingOnlyToMe = preference('followingOnlyToMe')
    const signups = isAdmin(user) ? preference('signups') : null
    const deviceId = notificationDevice(c.req.raw) || token()
    const userAgent = notificationUserAgent(c.req.raw)
    await databaseService().call('account.savePushSubscription', { userId: user.id, endpoint, p256dh, auth, deviceId,
      userAgent, preferencesProvided: Boolean(value.preferences),
      preferences: { latest, replies, mentions, follows, signups, followActivity, broadcasts, followingNotes,
        followingOnlyToMe, peopleFollowActivity, hashtagFollowActivity } })
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
    const userAgent = notificationUserAgent(c.req.raw)
    const result = await databaseService().call('account.removePushSubscription', {
      userId: user.id,
      endpoint: value.endpoint,
      userAgent,
    })
    return c.json({ removed: true, active: result.active })
  })

  app.get('/account/edit', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/edit'))
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    const settings = await databaseService().call('account.editSettings', { userId: user.id })
    return page(
      <Profile user={user}
        profile={{ ...user, timezone: settings?.timezone, recap_emails: settings?.recapEmails,
          interaction_emails: settings?.interactionEmails }} posts={[]} following={false} editing
        returnPath={returnPath} />,
    )
  })

  app.get('/account/recap-emails', async c => {
    return redirect('/account/email-preferences')
  })

  app.get('/account/email-preferences', async c => {
    const user = currentUser(c.req.raw)
    const value = c.req.query('token') || ''
    const returnPath = c.req.query('from') ? safeNext(c.req.query('from')) : undefined
    if (!user && !value) return redirect('/enter?next=' + encodeURIComponent('/account/email-preferences'))
    const preference = await databaseService().call('account.emailPreferences', {
      userId: user?.id,
      token: user ? undefined : value,
    })
    if (!preference) return page(<EmailPreferences recap={false} interactions={false} invalid />, 404)
    return page(
      <EmailPreferences user={user} recap={preference.recap} interactions={preference.interactions}
        token={user ? undefined : value} returnPath={returnPath} />,
    )
  })

  app.post('/account/email-preferences', async c => {
    const user = currentUser(c.req.raw)
    const f = await form(c.req.raw)
    const changed = await databaseService().call('account.setEmailPreferences', {
      userId: user?.id,
      token: user ? undefined : f.token,
      recap: f.recap === '1',
      interactions: f.interactions === '1',
    })
    if (!changed) return page(<EmailPreferences recap={false} interactions={false} invalid />, 404)
    if (f.back) return redirect(safeNext(f.back))
    return page(
      <EmailPreferences user={user} recap={f.recap === '1'} interactions={f.interactions === '1'}
        token={user ? undefined : f.token} changed />,
    )
  })

  app.get('/account/recap-emails/unsubscribe', async c => {
    const value = c.req.query('token') || ''
    const changed = await databaseService().call('account.setRecapPreference', { token: value, subscribed: false })
    if (!changed) return page(<EmailPreferences recap={false} interactions={false} invalid />, 404)
    const preference = await databaseService().call('account.emailPreferences', { token: value })
    return page(
      <EmailPreferences recap={false} interactions={preference?.interactions ?? false} token={value} changed />,
    )
  })

  app.post('/account/recap-emails/unsubscribe', async c => {
    const value = c.req.query('token') || ''
    const changed = await databaseService().call('account.setRecapPreference', { token: value, subscribed: false })
    if (!changed) return c.text('Unsubscribe link unavailable', 404)
    return c.text('Unsubscribed', 200)
  })

  app.post('/account/recap-emails', async c => {
    const user = currentUser(c.req.raw)
    const f = await form(c.req.raw)
    if (f.subscribed !== '0' && f.subscribed !== '1') return redirect('/account/recap-emails')
    const subscribed = f.subscribed === '1'
    const changed = await databaseService().call('account.setRecapPreference', {
      userId: user?.id,
      token: user ? undefined : f.token,
      subscribed,
    })
    if (!changed) return redirect('/enter?next=' + encodeURIComponent('/account/recap-emails'))
    return page(<RecapEmails user={user} subscribed={subscribed} token={user ? undefined : f.token} changed />)
  })

  app.get('/account/interacted-emails', async c => {
    return redirect('/account/email-preferences')
  })

  app.get('/account/interacted-emails/unsubscribe', async c => {
    const value = c.req.query('token') || ''
    const changed = await databaseService().call('account.setInteractedPreference', {
      token: value,
      subscribed: false,
    })
    if (!changed) return page(<EmailPreferences recap={false} interactions={false} invalid />, 404)
    const preference = await databaseService().call('account.emailPreferences', { token: value })
    return page(<EmailPreferences recap={preference?.recap ?? false} interactions={false} token={value} changed />)
  })

  app.post('/account/interacted-emails/unsubscribe', async c => {
    const value = c.req.query('token') || ''
    const changed = await databaseService().call('account.setInteractedPreference', {
      token: value,
      subscribed: false,
    })
    if (!changed) return c.text('Unsubscribe link unavailable', 404)
    return c.text('Unsubscribed', 200)
  })

  app.post('/account/interacted-emails', async c => {
    const user = currentUser(c.req.raw)
    const f = await form(c.req.raw)
    if (f.subscribed !== '0' && f.subscribed !== '1') return redirect('/account/interacted-emails')
    const subscribed = f.subscribed === '1'
    const changed = await databaseService().call('account.setInteractedPreference', {
      userId: user?.id,
      token: user ? undefined : f.token,
      subscribed,
    })
    if (!changed) return redirect('/enter?next=' + encodeURIComponent('/account/interacted-emails'))
    return page(<InteractedEmails user={user} subscribed={subscribed} token={user ? undefined : f.token} changed />)
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
    const submittedMood = f.mood || ''
    const submittedTimezone = f.timezone || user.timezone || DEFAULT_TIMEZONE
    const suggestionSearch = await profileSuggestionSearch(f, user.id)
    if (suggestionSearch) {
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editMood={submittedMood} editing returnPath={returnPath}
          suggestionSearch={suggestionSearch} />,
      )
    }
    const handle = submittedHandle.toLowerCase().replace(/^@/, '')
    const validHandle = /^[a-z0-9_]{2,24}$/.test(handle)
    const validMood = submittedMood === '' || /^\p{Extended_Pictographic}$/u.test(submittedMood)
    if (!validHandle || !validMood || !validBioBody(bio) || !validTimezone(submittedTimezone)) {
      const handleCharacters = Array.from(submittedHandle).length
      const error = [
        !validHandle
          ? `You typed ${handleCharacters} ${
            handleCharacters === 1 ? 'character' : 'characters'
          }. Use 2–24 letters, numbers, or underscores.`
          : '',
        !validBioBody(bio) ? bioBodyValidationMessage(bio) : '',
        !validMood ? 'Mood should be an emoji.' : '',
        !validTimezone(submittedTimezone) ? 'Choose a valid timezone.' : '',
      ].filter(Boolean).join(' ')
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editMood={submittedMood} editing error={error} returnPath={returnPath} />,
        400,
      )
    }
    if (handle || bio) {
      const moderation = await moderateText(`username: ${handle}\nbio: ${bio}`)
      if (!moderation.ok) {
        return page(
          <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
            editHandle={submittedHandle} editMood={submittedMood} editing error={moderationMessage(moderation)}
            returnPath={returnPath} />,
          moderation.reason === 'flagged' ? 422 : 503,
        )
      }
    }
    const updated = await databaseService().call('account.updateProfile', {
      userId: user.id,
      handle,
      mood: submittedMood,
      bio,
      timezone: submittedTimezone,
    })
    if (updated.status !== 'ready') {
      const error = updated.status === 'change-limit'
        ? 'You can change your handle up to two times per month. Try again next month.'
        : 'That username is unavailable.'
      return page(
        <Profile user={user} profile={{ ...user, timezone: submittedTimezone }} posts={[]} following={false} bio={bio}
          editHandle={submittedHandle} editMood={submittedMood} editing error={error} returnPath={returnPath} />,
        400,
      )
    }
    const previews = await discoverLinkPreviews(bio)
    const newKeys = previews.flatMap(preview => 'imageKey' in preview && preview.imageKey ? [preview.imageKey] : [])
    try {
      const persisted = await databaseService().call('api.persistBioPreviews', { userId: user.id, previews })
      await deleteImagesAfterCommit(persisted.obsoleteImageKeys)
    }
    catch (error) {
      await deleteImages(newKeys)
      throw error
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
        selectedSize={fontSizeChoice(c.req.raw)} selectedPageSize={resolvedPageSize(c.req.raw)} tab={tab}
        selectedDensity={resolvedDensity(c.req.raw)} selectedLinkPreviews={user.show_link_previews !== 0}
        selectedCorners={cornerChoice(c.req.raw)} showModeratedContent={user.show_moderated_content === 1}
        includePeopleFollowActivity={user.hide_people_follow_activity !== 1}
        includeHashtagFollowActivity={user.hide_hashtag_follow_activity !== 1}
        showNoteStreak={user.show_note_streak === 1} showTimestamps={user.show_timestamps === 1}
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
    const completeAppearance = f.completeAppearance === 'yes'
    const theme = (f.theme || appearance(c.req.raw).theme) as ThemeChoice
    const accent = (f.accent || appearance(c.req.raw).accent) as AccentChoice
    const selectedFont = (f.font || fontChoice(c.req.raw)) as FontChoice
    const selectedSansSerif = (f.sansSerifFont || sansSerifFontChoice(c.req.raw)) as SansSerifFontChoice
    const selectedPrimary = (f.primaryFont || primaryFontChoice(c.req.raw)) as PrimaryFontChoice
    const selectedSize = (f.fontSize || fontSizeChoice(c.req.raw)) as FontSizeChoice
    const selectedDensity = (f.density || resolvedDensity(c.req.raw)) as DensityChoice
    const selectedCorners = (f.corners || cornerChoice(c.req.raw)) as CornerChoice
    if (!THEME_CHOICES.includes(theme) || !ACCENT_CHOICES.includes(accent)
      || !FONT_CHOICES.some(font => font.value === selectedFont)
      || !SANS_SERIF_FONT_CHOICES.some(font => font.value === selectedSansSerif)
      || !PRIMARY_FONT_CHOICES.includes(selectedPrimary)
      || !FONT_SIZE_CHOICES.some(size => size.value === selectedSize)
      || !DENSITY_CHOICES.includes(selectedDensity) || !CORNER_CHOICES.includes(selectedCorners))
    {
      return page(
        <ChangeAppearance user={user} selected={appearance(c.req.raw)} selectedFont={fontChoice(c.req.raw)}
          selectedSansSerifFont={sansSerifFontChoice(c.req.raw)} selectedPrimaryFont={primaryFontChoice(c.req.raw)}
          selectedSize={fontSizeChoice(c.req.raw)} tab={tab} selectedPageSize={resolvedPageSize(c.req.raw)}
          selectedDensity={resolvedDensity(c.req.raw)} returnPath={returnPath} />,
        400,
      )
    }
    const deviceId = notificationDevice(c.req.raw) || token()
    if (completeAppearance || tab === 'misc') {
      await databaseService().call('account.saveAppearancePreferences', {
        userId: user.id,
        deviceId,
        pageSize: PAGE_SIZE,
        density: selectedDensity,
        showLinkPreviews: f.showLinkPreviews === 'yes',
        showModeratedContent: f.showModeratedContent === 'yes',
        hidePeopleFollowActivity: f.includePeopleFollowActivity !== 'yes',
        hideHashtagFollowActivity: f.includeHashtagFollowActivity !== 'yes',
        showNoteStreak: f.showNoteStreak === 'yes',
        showTimestamps: f.showTimestamps === 'yes',
      })
    }
    await markAppearanceBannerHandled(c.req.raw, user.id)
    const response = redirect('/account/edit/appearance' + query, appearanceCookie({ theme, accent }))
    response.headers.append('set-cookie', fontCookie(selectedFont))
    response.headers.append('set-cookie', sansSerifFontCookie(selectedSansSerif))
    response.headers.append('set-cookie', primaryFontCookie(selectedPrimary))
    response.headers.append('set-cookie', fontSizeCookie(selectedSize))
    response.headers.append('set-cookie', notificationDeviceCookie(deviceId))
    response.headers.append('set-cookie', cornerCookie(selectedCorners))
    return response
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
    const limited = await authLimit(c, 'api-key-create', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
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
    const lifetime = lifetimes[f.lifetime]
    const now = Date.now()
    const issued = await databaseService().call('account.issueKey', { kind: 'api', userId: user.id, name,
      expiresAt: lifetime === null ? null : now + lifetime, now })
    if (!issued) {
      return page(
        <AccountApiKeyCreate user={user} name={name} lifetime={f.lifetime}
          error="Revoke an existing key before creating another." />,
        400,
      )
    }
    return page(<AccountApiKey user={user} name={name} value={issued.value} />)
  })

  app.post('/account/api-keys/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (/^\d+$/.test(f.id || '')) {
      await databaseService().call('account.revokeKey', {
        kind: 'api',
        userId: user.id,
        id: Number(f.id),
      })
    }
    return redirect('/account/security#api-keys')
  })

  app.get('/account/feed-keys/new', c => {
    const user = currentUser(c.req.raw)
    return user
      ? page(<AccountFeedKeyCreate user={user} />)
      : redirect('/enter?next=' + encodeURIComponent('/account/feed-keys/new'))
  })

  app.post('/account/feed-keys', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = await authLimit(c, 'feed-key-create', `${user.id}:${clientAddress(c)}`,
      AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(await securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
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
        <AccountFeedKeyCreate user={user} name={name} lifetime={f.lifetime}
          error="Enter a key name and choose a valid expiration." />,
        400,
      )
    }
    const lifetime = lifetimes[f.lifetime]
    const now = Date.now()
    const issued = await databaseService().call('account.issueKey', { kind: 'feed', userId: user.id, name,
      expiresAt: lifetime === null ? null : now + lifetime, now })
    if (!issued) {
      return page(
        <AccountFeedKeyCreate user={user} name={name} lifetime={f.lifetime}
          error="Revoke an existing key before creating another." />,
        400,
      )
    }
    return c.redirect(`/feeds/my-feed/${issued.value}?created=1`, 303)
  })

  app.post('/account/feed-keys/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    if (/^\d+$/.test(f.id || '')) {
      await databaseService().call('account.revokeKey', {
        kind: 'feed',
        userId: user.id,
        id: Number(f.id),
      })
    }
    return redirect('/account/security?revoked=feed#feed-keys')
  })

  app.get('/account/password/enable', async c => {
    const user = currentUser(c.req.raw)
    const value = c.req.query('token') || ''
    if (value) {
      return await databaseService().call('account.passwordEnableTokenValid', { tokenHash: hash(value),
          now: Date.now() })
        ? page(<AccountPassword user={user} enabled={false} token={value} />)
        : page(<AccountPassword user={user} enabled={false} invalid />, 400)
    }
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/password/enable'))
    const passwordHash = await databaseService().call('account.passwordHash', { userId: user.id })
    return passwordHash === '!'
      ? page(<AccountPassword user={user} enabled={false} request />)
      : redirect('/account/password/change')
  })
  app.post('/account/password/enable', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    const limited = await authLimit(c, 'password-enable', `${user.id}:${clientAddress(c)}`,
      AUTH_LIMITS.sensitiveAccount)
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
    const tokenValid = Boolean(f.token) && await databaseService().call('account.passwordEnableTokenValid', {
      tokenHash: hash(f.token),
      now: Date.now(),
    })
    if (!f.token) {
      const currentPasswordHash = await databaseService().call('account.passwordHash', { userId: user.id })
      if (currentPasswordHash !== '!') return redirect('/account/password/change')
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      const value = token()
      const tokenHash = hash(value)
      await databaseService().call('account.storePasswordEnableToken', {
        userId: user.id,
        email: user.email,
        tokenHash,
        expiresAt: Date.now() + 3600000,
        now: Date.now(),
      })
      try {
        await sendPasswordEnableConfirmation(user.email,
          `${origin}/account/password/enable?token=${encodeURIComponent(value)}`)
      }
      catch (error) {
        await databaseService().call('account.deletePasswordEnableToken', { tokenHash })
        console.error('Could not send password-enable confirmation', error)
        return page(
          <AccountPassword user={user} enabled={false} request
            error="Setup email could not be sent. Please try again later." />,
          503,
        )
      }
      return page(<AccountPassword user={user} enabled={false} sent />)
    }
    if (!tokenValid) return page(<AccountPassword user={user} enabled={false} invalid />, 400)
    const password = f.newPassword || ''
    if (password.length < 8 || password.length > 128) {
      return page(
        <AccountPassword user={user} enabled={false} token={f.token}
          error="Use a password between 8 and 128 characters." />,
        400,
      )
    }
    const passwordHash = await hashPassword(password)
    const enabled = await databaseService().call('account.consumePasswordEnableToken', {
      tokenHash: hash(f.token),
      passwordHash,
      now: Date.now(),
    })
    if (!enabled) return page(<AccountPassword user={user} enabled={false} invalid />, 400)
    return redirect('/account/security?enabled=password')
  })

  app.get('/account/password/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/password/change'))
    const passwordHash = await databaseService().call('account.passwordHash', { userId: user.id })
    return passwordHash === '!'
      ? redirect('/account/password/enable')
      : page(<AccountPassword user={user} enabled />)
  })
  app.post('/account/password/change', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const limited = await authLimit(c, 'password-change', `${user.id}:${clientAddress(c)}`,
      AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(
        page(<AccountPassword user={user} enabled error={authRateLimitMessage(limited.retryAfter)} />, 429),
        limited.retryAfter,
      )
    }
    const f = await form(c.req.raw)
    const oldPassword = f.oldPassword || ''
    const newPassword = f.newPassword || ''
    const currentPasswordHash = await databaseService().call('account.passwordHash', { userId: user.id })
    if (currentPasswordHash === '!') return redirect('/account/password/enable')
    if (!currentPasswordHash || !await verifyPassword(oldPassword, currentPasswordHash)) {
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
    await databaseService().call('account.changePassword', {
      userId: user.id,
      passwordHash: newPasswordHash,
      currentSessionHash: currentSession,
    })
    return redirect('/account/security?changed=password')
  })

  app.post('/account/magic-link', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/security'))
    const limited = await authLimit(c, 'account-magic-link', `${user.id}:${clientAddress(c)}`,
      AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(await securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
        limited.retryAfter)
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const { url: magicUrl, code } = await issueMagicLink(user.email, user.id, '/', origin)
    return page(<AccountMagicLink user={user} magicUrl={magicUrl} code={code} />)
  })

  app.get('/account/export', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter?next=' + encodeURIComponent('/account/export'))
    const data = await databaseService().call('account.export', {
      userId: user.id,
      currentSession: sessionToken(c.req.raw),
    })
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
    const limited = await authLimit(c, 'account-email', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    if (limited) {
      return retryPage(await securityPage(c.req.raw, authRateLimitMessage(limited.retryAfter), undefined, 429),
        limited.retryAfter)
    }
    const f = await form(c.req.raw)
    const email = (f.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return securityPage(c.req.raw, 'Enter a valid email address.', undefined, 400)
    }
    const readiness = await databaseService().call('account.emailChangeReadiness', { userId: user.id, email })
    if (readiness.status === 'unavailable') {
      return securityPage(c.req.raw, 'That email address is unavailable.', undefined, 400)
    }
    if (readiness.passwordHash !== '!' && !await verifyPassword(f.password || '', readiness.passwordHash)) {
      return securityPage(c.req.raw, 'Password is incorrect.', undefined, 400)
    }
    try {
      if (readiness.passwordHash !== '!') {
        await issueEmailToken(user.id, email, 'change')
        return securityPage(c.req.raw, undefined, 'A confirmation link was sent to your new email address.')
      }
      const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
      const value = token()
      await databaseService().call('account.storeEmailChangeAuthorization', { userId: user.id, currentEmail: user.email,
        newEmail: email, tokenHash: hash(value), expiresAt: Date.now() + 3600000, now: Date.now() })
      await sendEmailChangeAuthorization(user.email,
        `${origin}/account/email/change/authorize?token=${encodeURIComponent(value)}`)
      return securityPage(c.req.raw, undefined, 'An approval link was sent to your current email address.')
    }
    catch (error) {
      await databaseService().call('account.deleteEmailChangeAuthorization', { userId: user.id })
      console.error('Could not send email-change confirmation', error)
      return securityPage(c.req.raw, 'Confirmation email could not be sent. Please try again later.', undefined, 503)
    }
  })

  app.get('/account/email/change/authorize', async c => {
    const value = c.req.query('token') || ''
    const change = await databaseService().call('account.emailChangeAuthorization', {
      tokenHash: hash(value),
      now: Date.now(),
    })
    return change
      ? page(<ConfirmEmail token={value} kind="authorize-change" email={change.newEmail} />)
      : page(<ConfirmEmail invalid />, 400)
  })

  app.post('/account/email/change/authorize', async c => {
    const f = await form(c.req.raw)
    const value = f.token || ''
    const change = await databaseService().call('account.emailChangeAuthorization', {
      tokenHash: hash(value),
      now: Date.now(),
    })
    if (!change) return page(<ConfirmEmail invalid />, 400)
    try {
      await issueEmailToken(change.userId, change.newEmail, 'change')
      await databaseService().call('account.deleteEmailChangeAuthorization', { userId: change.userId })
      return page(<ConfirmEmail pending email={change.newEmail} />)
    }
    catch (error) {
      console.error('Could not send new-email confirmation', error)
      return page(
        <ConfirmEmail token={value} kind="authorize-change" email={change.newEmail}
          error="Confirmation email could not be sent. Please try again later." />,
        503,
      )
    }
  })

  app.get('/verify-email', async c => {
    const value = c.req.query('token') || ''
    if (!value) return redirect('/account/security')
    const record = await databaseService().call('account.emailToken', { tokenHash: hash(value), now: Date.now() })
    return record
      ? page(<ConfirmEmail token={value} kind={record.kind} email={record.email} />)
      : page(<ConfirmEmail invalid />, 400)
  })

  app.post('/verify-email', async c => {
    const f = await form(c.req.raw)
    const result = await databaseService().call('account.confirmEmailToken', { value: f.token || '', now: Date.now() })
    if (!result.ok) return page(<ConfirmEmail invalid />, 400)
    return result.kind === 'change'
      ? redirect('/account/security?changed=email')
      : redirect('/explore', exploreWelcomeCookie())
  })

  app.post('/account/sessions/revoke', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const f = await form(c.req.raw)
    await databaseService().call('account.revokeSession', { userId: user.id, tokenHash: f.token,
      currentSessionHash: sessionHash(sessionToken(c.req.raw)) })
    return redirect('/account/security#sessions')
  })

  app.post('/account/sessions/revoke-others', async c => {
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    await databaseService().call('account.revokeOtherSessions', {
      userId: user.id,
      currentSessionHash: sessionHash(sessionToken(c.req.raw)),
    })
    return redirect('/account/security#sessions')
  })

  app.get('/account/delete', async c => {
    const value = c.req.query('token') || ''
    if (value) {
      const account = await databaseService().call('account.deletionInfo', {
        selector: { tokenHash: hash(value) },
        now: Date.now(),
      })
      return account
        ? page(<ConfirmAccountDelete user={currentUser(c.req.raw)} handle={account.handle} token={value} />)
        : page(<ConfirmAccountDelete user={currentUser(c.req.raw)} invalid />, 400)
    }
    const user = currentUser(c.req.raw)
    if (!user) return redirect('/enter')
    const account = await databaseService().call('account.deletionInfo', {
      selector: { userId: user.id },
      now: Date.now(),
    })
    return page(<ConfirmAccountDelete user={user} passwordEnabled={account?.passwordHash !== '!'} />)
  })

  app.post('/account/delete', async c => {
    const user = currentUser(c.req.raw)
    const f = await form(c.req.raw)
    const deletionAccount = f.token
      ? await databaseService().call('account.deletionInfo', {
        selector: { tokenHash: hash(f.token) },
        now: Date.now(),
      })
      : null
    if (deletionAccount) {
      if (isAdmin({ email: deletionAccount.email }) && deletionAccount.primary) {
        return c.text('Admin accounts cannot delete themselves', 403)
      }
      const deleted = await databaseService().call('account.delete', { userId: deletionAccount.id })
      await deleteImagesAfterCommit(deleted.imageKeys)
      return redirect('/', clearSessionCookie())
    }
    if (f.token) return page(<ConfirmAccountDelete user={user} invalid />, 400)
    if (!user) return redirect('/enter')
    const account = await databaseService().call('account.deletionInfo', {
      selector: { userId: user.id },
      now: Date.now(),
    })
    if (!account) return redirect('/enter')
    if (isAdmin(user) && account.primary) return c.text('Admin accounts cannot delete themselves', 403)
    const limited = await authLimit(c, 'account-delete', `${user.id}:${clientAddress(c)}`, AUTH_LIMITS.sensitiveAccount)
    const passwordEnabled = account.passwordHash !== '!'
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
      if (!await verifyPassword(f.password || '', account.passwordHash)) {
        return page(<ConfirmAccountDelete user={user} passwordEnabled error="Password is incorrect." />, 400)
      }
      const deleted = await databaseService().call('account.delete', { userId: user.id })
      await deleteImagesAfterCommit(deleted.imageKeys)
      return redirect('/', clearSessionCookie())
    }
    const origin = Bun.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const value = token()
    const tokenHash = hash(value)
    const confirmationUrl = `${origin}/account/delete?token=${encodeURIComponent(value)}`
    await databaseService().call('account.storeDeletionToken', { userId: user.id, email: user.email, tokenHash,
      expiresAt: Date.now() + 3600000, now: Date.now() })
    try {
      await sendAccountDeletionConfirmation(
        user.email,
        user.handle,
        confirmationUrl,
      )
    }
    catch (error) {
      await databaseService().call('account.deleteDeletionToken', { tokenHash })
      console.error('Could not send account-deletion confirmation', error)
      return page(
        <ConfirmAccountDelete user={user} error="Confirmation email could not be sent. Please try again later." />,
        503,
      )
    }
    return page(
      <ConfirmAccountDelete user={user} sent confirmationUrl={isDevelopment() ? confirmationUrl : undefined} />,
    )
  })
}
