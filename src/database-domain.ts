import type { Database } from 'bun:sqlite'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { statSync } from 'node:fs'
import { accountChoices, accountForEmail, accountGroupForUser, createAccountGroup, isPrimaryAccount,
  markGroupEmailVerified, MONTHLY_NEW_ACCOUNT_LIMIT, recentAccountCreations, selectAccount } from './account-groups'
import { anonymizeUser, recordAdminAction, resolvePostReports, softDeletePost } from './admin'
import { API_DEFAULT_LIMIT, apiHotPosts, apiPost, apiPosts, apiReplies, apiSearchPosts, encodeCursor } from './api'
import { apiActivities } from './api-activity'
import { issueApiKey } from './api-keys'
import { consumeAuthAttempt, consumeBucketedAttempt, rateLimitKey } from './auth-rate-limit'
import { runAutomatedBackup } from './backup-automation'
import { cacheDb } from './cache-db'
import { exportUserData } from './data-export'
import { createBootDatabaseBackup } from './database-backup'
import type { DatabaseDomainInput, DatabaseDomainOperation, DatabaseDomainOutput } from './database-contract'
import { confirmEmailToken } from './email-verification'
import { suggestedPeople, suggestedPeopleCount, trendingTagCount, trendingTags } from './explore'
import { issueFeedKey, userForFeedKey } from './feed-keys'
import { feedSnapshotPage } from './feed-snapshots'
import { hasUnreadForYou, hasUnreadToMe, markAllForYouRead, markVisibleForYouEntriesRead,
  unreadForYouCount } from './for-you-state'
import { resolveHandle } from './handles'
import { claimInitialHandle, updateProfileHandle } from './handles'
import { getHotPosts, type HotPost, hotRankingVersion } from './hot'
import { isImageKey } from './image-storage'
import { runBoundedCleanup } from './maintenance'
import { MAX_MATERIALIZED_PAGES } from './materialized-feed-pages'
import { PAGE_SIZE } from './pagination'
import { TAG_PAGE_SIZE } from './pagination'
import { CONNECTION_PAGE_SIZE } from './pagination'
import { consumePasswordCaptcha, issuePasswordCaptcha, passwordCaptchaRequired,
  recordFailedPassword } from './password-login-captcha'
import { consumePasswordLoginNonce, issuePasswordLoginNonce } from './password-login-nonce'
import { loadPersonalizedFeed } from './personalized-feed'
import { loadBioReferenceData, loadThreadReplies } from './posts'
import { enrichPosts } from './posts'
import { visibleTagFollowerCounts, visibleUserProfileStats } from './posts'
import { createPost, updatePost } from './posts'
import { createPublicArchive, publicArchiveIsCurrent } from './public-archive'
import { RECAP_POPULAR_NOTE_IDS, recapEmail } from './recap-email'
import { searchPeople, searchPosts, searchTags, searchTerms } from './search'
import { sitemapIndex, sitemapSection } from './seo'
import { insertSession, markSessionUsed, renewSession, SESSION_LIFETIME_MS, sessionHash } from './sessions'
import { dashboardStats } from './stats'
import type { User } from './types'
import type { PostView } from './types'

function attachPeopleStats(database: Database, people: import('./types').PersonView[], viewerId: number) {
  const stats = visibleUserProfileStats(database, people.map(person => person.id), viewerId)
  const followers = viewerId < 0 || !people.length ? new Set<number>() : new Set((database.query(
    `SELECT follower_id FROM follows WHERE following_id=? AND follower_id IN (${people.map(() => '?').join(',')})`,
  ).all(viewerId, ...people.map(person => person.id)) as { follower_id: number }[]).map(row => row.follower_id))
  return people.map(person => ({ ...person, profileStats: stats.get(person.id),
    followsViewer: followers.has(person.id) })
  )
}

function attachTagStats(database: Database, tags: import('./types').TagView[], viewerId: number) {
  const counts = visibleTagFollowerCounts(database, tags.map(tag => tag.tag), viewerId)
  return tags.map(tag => ({ ...tag, followerCount: counts[tag.tag] || 0 }))
}

function recapPosts(database: Database, viewerId: number) {
  if (!RECAP_POPULAR_NOTE_IDS.length) return []
  const placeholders = RECAP_POPULAR_NOTE_IDS.map(() => '?').join(',')
  const visibility = viewerId < 0 ? '' : `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
    AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
      WHERE ph.post_id=p.id AND bh.user_id=?)`
  const parameters = viewerId < 0
    ? [...RECAP_POPULAR_NOTE_IDS]
    : [...RECAP_POPULAR_NOTE_IDS, viewerId, viewerId, viewerId]
  const rows = database.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL AND u.deleted_at IS NULL
      AND u.suspended_at IS NULL ${visibility}`).all(...parameters) as PostView[]
  const byId = new Map(rows.map(post => [post.id, post]))
  return enrichPosts(database, RECAP_POPULAR_NOTE_IDS.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), viewerId)
}

function removePreviewRecords(database: Database, userId: number, postId?: number) {
  const keys: string[] = []
  if (database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'').get()) {
    const rows = postId == null
      ? database.query(`SELECT image_url FROM post_link_previews
        WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)`).all(userId)
      : database.query('SELECT image_url FROM post_link_previews WHERE post_id=?').all(postId)
    keys.push(...(rows as { image_url: string }[]).map(row => row.image_url).filter(isImageKey))
    if (postId == null) {
      database.query(
        'DELETE FROM post_link_previews WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)',
      ).run(userId)
    }
    else database.query('DELETE FROM post_link_previews WHERE post_id=?').run(postId)
  }
  if (postId == null && database.query(
    'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'user_bio_link_previews\'',
  ).get()) {
    keys.push(...(database.query('SELECT image_url FROM user_bio_link_previews WHERE user_id=?')
      .all(userId) as { image_url: string }[]).map(row => row.image_url).filter(isImageKey))
    database.query('DELETE FROM user_bio_link_previews WHERE user_id=?').run(userId)
  }
  return keys
}
import { DENSITY_CHOICES, type DensityChoice, PAGE_SIZE_CHOICES, type PageSizeChoice } from './request-preferences'

function sessionUser(database: Database, token: string | null): User | null {
  if (!token) return null
  const user = database.query(`SELECT u.id,u.handle,u.email,u.bio,u.suspended_at,u.email_verified_at,
      u.handle_chosen_at,u.show_link_previews,u.timezone
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL AND u.suspended_at IS NULL`)
    .get(sessionHash(token), Date.now()) as User | null
  if (user) markSessionUsed(database, token, Date.now())
  return user
}

function apiUser(database: Database, token: string | null, now: number): User | null {
  if (!token?.startsWith('tlk_')) return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const row = database.query(`SELECT u.id,u.handle,u.email,u.bio,u.suspended_at,u.email_verified_at,
      u.handle_chosen_at,u.timezone,k.id key_id
    FROM api_keys k JOIN users u ON u.id=k.user_id
    WHERE k.token_hash=? AND (k.expires_at IS NULL OR k.expires_at>?)
      AND u.deleted_at IS NULL AND u.suspended_at IS NULL`).get(tokenHash, now) as (User & { key_id: number }) | null
  if (!row) return null
  database.query('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now, row.key_id)
  const { key_id: _, ...user } = row
  return user
}

async function serialized(response: Response) {
  return { status: response.status, headers: [...response.headers] as [string, string][], body: await response.text() }
}

export async function executeDatabaseDomain<K extends DatabaseDomainOperation>(database: Database, operation: K,
  input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
{
  switch (operation) {
    case 'system.health': {
      const { databasePath } = input as DatabaseDomainInput<'system.health'>
      const started = performance.now()
      database.run('BEGIN IMMEDIATE')
      try {
        database.query('SELECT 1').get()
      }
      finally {
        database.run('ROLLBACK')
      }
      let walBytes = 0
      try {
        walBytes = statSync(`${databasePath}-wal`).size
      }
      catch {}
      const busyTimeoutMs = (database.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout
      return { writeLockLatencyMs: Math.round((performance.now() - started) * 100) / 100, walBytes,
        busyTimeoutMs } as DatabaseDomainOutput<K>
    }
    case 'system.blockedIps': {
      const { day } = input as DatabaseDomainInput<'system.blockedIps'>
      return database.query('SELECT ip_hash FROM daily_ip_requests WHERE day=? AND blocked_at IS NOT NULL')
        .all(day).map(row => (row as { ip_hash: string }).ip_hash) as DatabaseDomainOutput<K>
    }
    case 'maintenance.flushVisitors': {
      const { visits } = input as DatabaseDomainInput<'maintenance.flushVisitors'>
      if (!visits.length) return 0 as DatabaseDomainOutput<K>
      database.transaction(() => {
        const insert = database.query(`INSERT INTO daily_visitors(day,visitor_hash,anonymous_last_seen_at)
          VALUES(?,?,?) ON CONFLICT(day,visitor_hash) DO UPDATE SET anonymous_last_seen_at=CASE
            WHEN excluded.anonymous_last_seen_at IS NULL THEN daily_visitors.anonymous_last_seen_at
            WHEN daily_visitors.anonymous_last_seen_at IS NULL THEN excluded.anonymous_last_seen_at
            ELSE max(daily_visitors.anonymous_last_seen_at,excluded.anonymous_last_seen_at) END`)
        for (const visit of visits) insert.run(visit.day, visit.hash, visit.anonymousLastSeenAt)
      })()
      return visits.length as DatabaseDomainOutput<K>
    }
    case 'maintenance.flushIpRequests': {
      const { entries } = input as DatabaseDomainInput<'maintenance.flushIpRequests'>
      if (!entries.length) return 0 as DatabaseDomainOutput<K>
      database.transaction(() => {
        const upsert = database.query(`INSERT INTO daily_ip_requests(day,ip_hash,request_count) VALUES(?,?,?)
          ON CONFLICT(day,ip_hash) DO UPDATE SET request_count=request_count+excluded.request_count`)
        for (const entry of entries) upsert.run(entry.day, entry.hash, entry.requests)
      })()
      return entries.length as DatabaseDomainOutput<K>
    }
    case 'maintenance.cleanup': {
      const { now } = input as DatabaseDomainInput<'maintenance.cleanup'>
      return runBoundedCleanup(database, now) as DatabaseDomainOutput<K>
    }
    case 'maintenance.bootBackup': {
      const { directory } = input as DatabaseDomainInput<'maintenance.bootBackup'>
      return createBootDatabaseBackup(database, directory) as DatabaseDomainOutput<K>
    }
    case 'maintenance.automatedBackup': {
      const { directory, now } = input as DatabaseDomainInput<'maintenance.automatedBackup'>
      const result = await runAutomatedBackup(database, { directory, alertWebhookUrl: null }, new Date(now))
      return result as DatabaseDomainOutput<K>
    }
    case 'maintenance.publicArchive': {
      const { path, now } = input as DatabaseDomainInput<'maintenance.publicArchive'>
      const date = new Date(now)
      if (publicArchiveIsCurrent(path, date)) return null as DatabaseDomainOutput<K>
      return await createPublicArchive(database, path, date) as DatabaseDomainOutput<K>
    }
    case 'maintenance.recapPreview': {
      const { requestUrl } = input as DatabaseDomainInput<'maintenance.recapPreview'>
      return recapEmail(database, requestUrl, 'audit-preview') as DatabaseDomainOutput<K>
    }
    case 'blog.recapPosts': {
      const { viewerId } = input as DatabaseDomainInput<'blog.recapPosts'>
      return recapPosts(database, viewerId) as DatabaseDomainOutput<K>
    }
    case 'system.consumeAuthAttempt': {
      const { scope, identity, attempts, windowSeconds, now } = input as DatabaseDomainInput<
        'system.consumeAuthAttempt'
      >
      const result = consumeAuthAttempt(database, scope, rateLimitKey(identity), attempts, windowSeconds, now)
      return result as DatabaseDomainOutput<K>
    }
    case 'system.consumeBucketedAttempt': {
      const { scope, identity, attempts, bucketSeconds, now } = input as DatabaseDomainInput<
        'system.consumeBucketedAttempt'
      >
      const result = consumeBucketedAttempt(database, scope, rateLimitKey(identity), attempts, bucketSeconds, now)
      return result as DatabaseDomainOutput<K>
    }
    case 'auth.sessionUser': {
      const { token } = input as DatabaseDomainInput<'auth.sessionUser'>
      return sessionUser(database, token) as DatabaseDomainOutput<K>
    }
    case 'auth.apiUser': {
      const { token, now } = input as DatabaseDomainInput<'auth.apiUser'>
      return apiUser(database, token, now) as DatabaseDomainOutput<K>
    }
    case 'auth.resolve': {
      const { sessionToken: cookieToken, bearerToken, deviceId, now } = input as DatabaseDomainInput<'auth.resolve'>
      const signedIn = sessionUser(database, cookieToken)
      const bearerUser = apiUser(database, bearerToken, now) || sessionUser(database, bearerToken)
      const row = signedIn && deviceId
        ? database.query('SELECT page_size pageSize,density FROM device_settings WHERE user_id=? AND device_id=?')
          .get(signedIn.id, deviceId) as { pageSize: number; density: string } | null
        : null
      const pageSize = row && PAGE_SIZE_CHOICES.includes(row.pageSize as PageSizeChoice)
        ? row.pageSize as PageSizeChoice
        : PAGE_SIZE
      const density = row && DENSITY_CHOICES.includes(row.density as DensityChoice)
        ? row.density as DensityChoice
        : 'regular'
      const result = { sessionUser: signedIn, apiUser: bearerUser, preferences: { pageSize, density } }
      return result as DatabaseDomainOutput<K>
    }
    case 'auth.renewSession': {
      const { token, now } = input as DatabaseDomainInput<'auth.renewSession'>
      return renewSession(database, token, now) as DatabaseDomainOutput<K>
    }
    case 'account.timezone': {
      const { userId } = input as DatabaseDomainInput<'account.timezone'>
      const row = database.query('SELECT timezone FROM users WHERE id=?').get(userId) as
        | { timezone: string | null }
        | null
      return (row?.timezone ?? null) as DatabaseDomainOutput<K>
    }
    case 'account.choices': {
      const { userId } = input as DatabaseDomainInput<'account.choices'>
      return accountChoices(database, userId) as DatabaseDomainOutput<K>
    }
    case 'account.select': {
      const { userId, targetId, sessionHash: currentSessionHash } = input as DatabaseDomainInput<'account.select'>
      const group = accountGroupForUser(database, userId)
      const target = group && database.query(`SELECT id,handle_chosen_at FROM users
        WHERE id=? AND account_group_id=? AND deleted_at IS NULL AND suspended_at IS NULL`)
        .get(targetId, group.id) as { id: number; handle_chosen_at: string | null } | null
      if (!target) return { status: 'not_found' } as DatabaseDomainOutput<K>
      database.transaction(() => {
        if (!selectAccount(database, target.id)) throw new Error('Account is unavailable')
        database.query('UPDATE sessions SET user_id=? WHERE token_hash=? AND user_id=?')
          .run(target.id, currentSessionHash, userId)
      })()
      return { status: 'ready', handleChosen: Boolean(target.handle_chosen_at) } as DatabaseDomainOutput<K>
    }
    case 'account.createLinked': {
      const { userId, sessionHash: currentSessionHash } = input as DatabaseDomainInput<'account.createLinked'>
      const group = accountGroupForUser(database, userId)
      if (!group) return false as DatabaseDomainOutput<K>
      let newUserId: number | null = null
      database.transaction(() => {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const handle = `anon${randomBytes(8).toString('hex').slice(0, 12)}`
            const created = database.query(`INSERT INTO users(handle,email,password,email_verified_at,account_group_id)
              VALUES(?,?,'!',CURRENT_TIMESTAMP,?) RETURNING id`).get(handle, group.email, group.id) as { id: number }
            newUserId = created.id
            break
          }
          catch {}
        }
        if (!newUserId || !selectAccount(database, newUserId)) throw new Error('Could not create account')
        database.query('UPDATE sessions SET user_id=? WHERE token_hash=? AND user_id=?')
          .run(newUserId, currentSessionHash, userId)
      })()
      return true as DatabaseDomainOutput<K>
    }
    case 'account.pushPreferences': {
      const { userId, endpoint, includeSignups } = input as DatabaseDomainInput<'account.pushPreferences'>
      if (!endpoint) return null as DatabaseDomainOutput<K>
      return database.query(`SELECT notify_latest latest,notify_replies replies,notify_mentions mentions,
        notify_follows follows,notify_follow_activity followActivity,notify_following_notes followingNotes,
        notify_bots bots,notify_following_only_to_me followingOnlyToMe${includeSignups ? ',notify_signups signups' : ''}
        FROM push_subscriptions WHERE endpoint=? AND user_id=?`).get(endpoint, userId) as DatabaseDomainOutput<K>
    }
    case 'account.savePushSubscription': {
      const { userId, endpoint, p256dh, auth, deviceId, userAgent, preferencesProvided, preferences } =
        input as DatabaseDomainInput<'account.savePushSubscription'>
      const { latest, replies, mentions, follows, signups, followActivity, followingNotes, bots, followingOnlyToMe } =
        preferences
      database.transaction(() => {
        database.query('UPDATE push_subscriptions SET p256dh=?,auth=?,device_id=? WHERE endpoint=?')
          .run(p256dh, auth, deviceId, endpoint)
        database.query(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,device_id,
            notify_latest,notify_replies,notify_mentions,notify_follows,notify_own_posts,notify_signups,
            notify_follow_activity,notify_following_notes,notify_bots,notify_following_only_to_me)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(endpoint,user_id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
            device_id=excluded.device_id,notify_latest=coalesce(?,push_subscriptions.notify_latest),
            notify_replies=coalesce(?,push_subscriptions.notify_replies),
            notify_mentions=coalesce(?,push_subscriptions.notify_mentions),
            notify_follows=coalesce(?,push_subscriptions.notify_follows),notify_own_posts=0,
            notify_signups=coalesce(?,push_subscriptions.notify_signups),
            notify_follow_activity=coalesce(?,push_subscriptions.notify_follow_activity),
            notify_following_notes=coalesce(?,push_subscriptions.notify_following_notes),
            notify_bots=coalesce(?,push_subscriptions.notify_bots),
            notify_following_only_to_me=coalesce(?,push_subscriptions.notify_following_only_to_me)`)
          .run(endpoint, userId, p256dh, auth, deviceId, latest ?? 1, replies ?? 1, mentions ?? 1, follows ?? 1, 0,
            signups ?? 1, followActivity ?? 1, followingNotes ?? 1, bots ?? 0, followingOnlyToMe ?? 0, latest, replies,
            mentions, follows, signups, followActivity, followingNotes, bots, followingOnlyToMe)
        if (userAgent) {
          database.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'enabled')
            ON CONFLICT(user_id,user_agent) DO UPDATE SET status='enabled',updated_at=CURRENT_TIMESTAMP`)
            .run(userId, userAgent)
          if (preferencesProvided) {
            database.query(`INSERT INTO notification_improvement_user_agents(user_id,user_agent)
            VALUES(?,?) ON CONFLICT(user_id,user_agent) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`)
              .run(userId, userAgent)
          }
        }
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.removePushSubscription': {
      const { userId, endpoint, userAgent } = input as DatabaseDomainInput<'account.removePushSubscription'>
      let active = false
      database.transaction(() => {
        database.query('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(endpoint, userId)
        active = Boolean(database.query('SELECT 1 FROM push_subscriptions WHERE endpoint=? LIMIT 1').get(endpoint))
        if (userAgent) {
          database.query(`DELETE FROM notification_user_agents
          WHERE user_id=? AND user_agent=? AND status='enabled'`).run(userId, userAgent)
        }
      })()
      return { active } as DatabaseDomainOutput<K>
    }
    case 'account.passwordHash': {
      const { userId } = input as DatabaseDomainInput<'account.passwordHash'>
      const row = database.query('SELECT password FROM users WHERE id=?').get(userId) as { password: string } | null
      return (row?.password ?? null) as DatabaseDomainOutput<K>
    }
    case 'account.storePasswordEnableToken': {
      const { userId, email, tokenHash, expiresAt, now } = input as DatabaseDomainInput<
        'account.storePasswordEnableToken'
      >
      const account = database.query('SELECT 1 FROM users WHERE id=? AND email=? AND password=? AND deleted_at IS NULL')
        .get(userId, email, '!')
      if (!account) return false as DatabaseDomainOutput<K>
      database.transaction(() => {
        database.query('DELETE FROM password_enable_tokens WHERE user_id=? OR expires_at<=?').run(userId, now)
        database.query('INSERT INTO password_enable_tokens(token_hash,user_id,email,expires_at) VALUES(?,?,?,?)')
          .run(tokenHash, userId, email, expiresAt)
      })()
      return true as DatabaseDomainOutput<K>
    }
    case 'account.passwordEnableTokenValid': {
      const { tokenHash, now } = input as DatabaseDomainInput<'account.passwordEnableTokenValid'>
      return Boolean(database.query(`SELECT 1 FROM password_enable_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=? AND t.expires_at>? AND u.deleted_at IS NULL AND u.password='!' AND u.email=t.email`)
        .get(tokenHash, now)) as DatabaseDomainOutput<K>
    }
    case 'account.deletePasswordEnableToken': {
      const { tokenHash } = input as DatabaseDomainInput<'account.deletePasswordEnableToken'>
      database.query('DELETE FROM password_enable_tokens WHERE token_hash=?').run(tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'account.consumePasswordEnableToken': {
      const { tokenHash, passwordHash, now } = input as DatabaseDomainInput<'account.consumePasswordEnableToken'>
      const account = database.query(`SELECT u.id FROM password_enable_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=? AND t.expires_at>? AND u.deleted_at IS NULL AND u.password='!' AND u.email=t.email`)
        .get(tokenHash, now) as { id: number } | null
      if (!account) return false as DatabaseDomainOutput<K>
      database.transaction(() => {
        database.query('UPDATE users SET password=? WHERE id=? AND password=?').run(passwordHash, account.id, '!')
        database.query('DELETE FROM password_enable_tokens WHERE user_id=?').run(account.id)
      })()
      return true as DatabaseDomainOutput<K>
    }
    case 'account.changePassword': {
      const { userId, passwordHash, currentSessionHash } = input as DatabaseDomainInput<'account.changePassword'>
      database.transaction(() => {
        database.query('UPDATE users SET password=? WHERE id=?').run(passwordHash, userId)
        database.query('DELETE FROM password_resets WHERE user_id=?').run(userId)
        database.query('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(userId, currentSessionHash || '')
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.updateProfile': {
      const { userId, handle, bio, timezone, isBot } = input as DatabaseDomainInput<'account.updateProfile'>
      try {
        database.transaction(() => {
          updateProfileHandle(database, userId, handle, bio)
          database.query('UPDATE users SET timezone=? WHERE id=?').run(timezone, userId)
          database.query('UPDATE users SET is_bot=? WHERE id=? AND bot_managed=0').run(isBot ? 1 : 0, userId)
          cacheDb.query(`DELETE FROM materialized_feed_pages_v2 WHERE viewer_id=?
            AND kind IN ('latest','hot','for-you','to-me')`).run(userId)
        })()
        return { status: 'ready' } as DatabaseDomainOutput<K>
      }
      catch {
        return { status: 'unavailable' } as DatabaseDomainOutput<K>
      }
    }
    case 'account.export': {
      const { userId, currentSession } = input as DatabaseDomainInput<'account.export'>
      return exportUserData(database, userId, currentSession) as DatabaseDomainOutput<K>
    }
    case 'account.emailChangeReadiness': {
      const { userId, email } = input as DatabaseDomainInput<'account.emailChangeReadiness'>
      const group = accountGroupForUser(database, userId)
      const unavailable = database.query('SELECT 1 FROM account_groups WHERE email=? AND id!=?')
        .get(email, group?.id ?? -1) || database.query(`SELECT 1 FROM users WHERE email=? AND deleted_at IS NULL
          AND (account_group_id IS NULL OR account_group_id!=?)`).get(email, group?.id ?? -1)
      if (unavailable) return { status: 'unavailable' } as DatabaseDomainOutput<K>
      const credentials = database.query('SELECT password FROM users WHERE id=?').get(userId) as {
        password: string
      } | null
      return (credentials
        ? { status: 'ready', passwordHash: credentials.password }
        : { status: 'unavailable' }) as DatabaseDomainOutput<K>
    }
    case 'account.storeEmailChangeAuthorization': {
      const { userId, currentEmail, newEmail, tokenHash, expiresAt, now } = input as DatabaseDomainInput<
        'account.storeEmailChangeAuthorization'
      >
      database.transaction(() => {
        database.query('DELETE FROM email_change_authorizations WHERE user_id=? OR expires_at<=?').run(userId, now)
        database.query(`INSERT INTO email_change_authorizations(token_hash,user_id,current_email,new_email,expires_at)
          VALUES(?,?,?,?,?)`).run(tokenHash, userId, currentEmail, newEmail, expiresAt)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.emailChangeAuthorization': {
      const { tokenHash, now } = input as DatabaseDomainInput<'account.emailChangeAuthorization'>
      const row = database.query(`SELECT a.user_id userId,a.new_email newEmail FROM email_change_authorizations a
        JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.expires_at>? AND u.deleted_at IS NULL
          AND u.password='!' AND u.email=a.current_email`).get(tokenHash, now)
      return (row || null) as DatabaseDomainOutput<K>
    }
    case 'account.deleteEmailChangeAuthorization': {
      const { userId } = input as DatabaseDomainInput<'account.deleteEmailChangeAuthorization'>
      database.query('DELETE FROM email_change_authorizations WHERE user_id=?').run(userId)
      return null as DatabaseDomainOutput<K>
    }
    case 'account.emailToken': {
      const { tokenHash, now } = input as DatabaseDomainInput<'account.emailToken'>
      const row = database.query(`SELECT user_id userId,kind,email FROM email_tokens
        WHERE token_hash=? AND expires_at>?`).get(tokenHash, now)
      return (row || null) as DatabaseDomainOutput<K>
    }
    case 'account.confirmEmailToken': {
      const { value, now } = input as DatabaseDomainInput<'account.confirmEmailToken'>
      return confirmEmailToken(database, value, now) as DatabaseDomainOutput<K>
    }
    case 'account.deletionInfo': {
      const { selector, now } = input as DatabaseDomainInput<'account.deletionInfo'>
      const account = ('userId' in selector
        ? database.query(`SELECT id,email,password passwordHash FROM users WHERE id=? AND deleted_at IS NULL`)
          .get(selector.userId)
        : database.query(`SELECT u.id,u.email,u.password passwordHash FROM account_deletion_tokens t
          JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>? AND u.deleted_at IS NULL
            AND u.password='!' AND u.email=t.email`).get(selector.tokenHash, now)) as {
          id: number
          email: string
          passwordHash: string
        } | null
      return (account ? { ...account, primary: isPrimaryAccount(database, account.id) } : null) as DatabaseDomainOutput<
        K
      >
    }
    case 'account.storeDeletionToken': {
      const { userId, email, tokenHash, expiresAt, now } = input as DatabaseDomainInput<'account.storeDeletionToken'>
      database.transaction(() => {
        database.query('DELETE FROM account_deletion_tokens WHERE user_id=? OR expires_at<=?').run(userId, now)
        database.query('INSERT INTO account_deletion_tokens(token_hash,user_id,email,expires_at) VALUES(?,?,?,?)')
          .run(tokenHash, userId, email, expiresAt)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.deleteDeletionToken': {
      const { tokenHash } = input as DatabaseDomainInput<'account.deleteDeletionToken'>
      database.query('DELETE FROM account_deletion_tokens WHERE token_hash=?').run(tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'account.delete': {
      const { userId } = input as DatabaseDomainInput<'account.delete'>
      const imageKeys: string[] = []
      database.transaction(() => {
        if (database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'').get()) {
          imageKeys.push(...(database.query(`SELECT image_url FROM post_link_previews
            WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)`).all(userId) as { image_url: string }[])
            .map(row => row.image_url).filter(isImageKey))
          database.query('DELETE FROM post_link_previews WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)')
            .run(userId)
        }
        if (database.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'user_bio_link_previews\'')
          .get())
        {
          imageKeys.push(...(database.query('SELECT image_url FROM user_bio_link_previews WHERE user_id=?')
            .all(userId) as { image_url: string }[]).map(row => row.image_url).filter(isImageKey))
          database.query('DELETE FROM user_bio_link_previews WHERE user_id=?').run(userId)
        }
        anonymizeUser(database, userId)
      })()
      return { imageKeys } as DatabaseDomainOutput<K>
    }
    case 'account.saveAppearancePreferences': {
      const { userId, deviceId, pageSize, density, showLinkPreviews } = input as DatabaseDomainInput<
        'account.saveAppearancePreferences'
      >
      database.transaction(() => {
        database.query(`INSERT INTO device_settings(user_id,device_id,page_size,density) VALUES(?,?,?,?)
          ON CONFLICT(user_id,device_id) DO UPDATE SET page_size=excluded.page_size,density=excluded.density,
            updated_at=CURRENT_TIMESTAMP`).run(userId, deviceId, pageSize, density)
        database.query('UPDATE users SET show_link_previews=? WHERE id=?')
          .run(showLinkPreviews ? 1 : 0, userId)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.updateProfileFlags': {
      const { userId, timezone, isBot } = input as DatabaseDomainInput<'account.updateProfileFlags'>
      database.transaction(() => {
        database.query('UPDATE users SET timezone=? WHERE id=?').run(timezone, userId)
        database.query('UPDATE users SET is_bot=? WHERE id=? AND bot_managed=0').run(isBot ? 1 : 0, userId)
        cacheDb.query(`DELETE FROM materialized_feed_pages_v2 WHERE viewer_id=?
          AND kind IN ('latest','hot','for-you','to-me')`).run(userId)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.editSettings': {
      const { userId } = input as DatabaseDomainInput<'account.editSettings'>
      const row = database.query(`SELECT is_bot isBot,bot_managed botManaged,timezone,recap_emails recapEmails
        FROM users WHERE id=?`).get(userId)
      return (row || null) as DatabaseDomainOutput<K>
    }
    case 'account.recapStatus': {
      const { userId, token } = input as DatabaseDomainInput<'account.recapStatus'>
      const row = userId
        ? database.query('SELECT id,recap_emails subscribed FROM users WHERE id=? AND deleted_at IS NULL').get(userId)
        : token
        ? database.query(`SELECT u.id,u.recap_emails subscribed FROM recap_unsubscribe_tokens t
          JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND u.deleted_at IS NULL`)
          .get(createHash('sha256').update(token).digest('hex'))
        : null
      if (!row) return null as DatabaseDomainOutput<K>
      const result = row as { id: number; subscribed: number }
      return { id: result.id, subscribed: result.subscribed !== 0 } as DatabaseDomainOutput<K>
    }
    case 'account.setRecapPreference': {
      const { userId, token, subscribed } = input as DatabaseDomainInput<'account.setRecapPreference'>
      const row = userId ? { id: userId } : token
        ? database.query(`SELECT u.id FROM recap_unsubscribe_tokens t
        JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND u.deleted_at IS NULL`)
          .get(createHash('sha256').update(token).digest('hex')) as { id: number } | null
        : null
      if (!row) return false as DatabaseDomainOutput<K>
      database.query(`UPDATE users SET recap_emails=? WHERE email=(SELECT email FROM users WHERE id=?)`)
        .run(subscribed ? 1 : 0, row.id)
      return true as DatabaseDomainOutput<K>
    }
    case 'account.securityData': {
      const { userId, currentSessionHash, now } = input as DatabaseDomainInput<'account.securityData'>
      const rows = database.query(`SELECT token_hash,created_at,expires_at,user_agent FROM sessions
        WHERE user_id=? AND expires_at>? ORDER BY created_at DESC`).all(userId, now) as {
        token_hash: string
        created_at: number
        expires_at: number
        user_agent: string
      }[]
      const credentials = database.query('SELECT password FROM users WHERE id=?').get(userId) as { password: string }
      const result = {
        sessions: rows.map(({ token_hash, ...row }) => ({ ...row, token: token_hash,
          current: token_hash === currentSessionHash })
        ),
        apiKeys: database.query(`SELECT id,name,created_at,expires_at,last_used_at FROM api_keys
          WHERE user_id=? ORDER BY created_at DESC`).all(userId),
        feedKeys: database.query(`SELECT id,name,created_at,expires_at,last_used_at FROM feed_keys
          WHERE user_id=? ORDER BY created_at DESC`).all(userId),
        passwordEnabled: credentials.password !== '!',
      }
      return result as DatabaseDomainOutput<K>
    }
    case 'account.issueKey': {
      const { kind, userId, name, expiresAt, now } = input as DatabaseDomainInput<'account.issueKey'>
      const table = kind === 'api' ? 'api_keys' : 'feed_keys'
      const result = database.transaction(() => {
        const count = (database.query(`SELECT count(*) count FROM ${table}
          WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)`).get(userId, now) as { count: number }).count
        if (count >= 20) return null
        return kind === 'api'
          ? issueApiKey(database, userId, name, expiresAt, now)
          : issueFeedKey(database, userId, name, expiresAt, now)
      })()
      return (result ? { value: result.value } : null) as DatabaseDomainOutput<K>
    }
    case 'account.revokeKey': {
      const { kind, userId, id } = input as DatabaseDomainInput<'account.revokeKey'>
      database.query(`DELETE FROM ${kind === 'api' ? 'api_keys' : 'feed_keys'} WHERE id=? AND user_id=?`)
        .run(id, userId)
      return null as DatabaseDomainOutput<K>
    }
    case 'account.revokeSession': {
      const { userId, tokenHash, currentSessionHash } = input as DatabaseDomainInput<'account.revokeSession'>
      if (tokenHash !== currentSessionHash) {
        database.query('DELETE FROM sessions WHERE token_hash=? AND user_id=?').run(tokenHash, userId)
      }
      return null as DatabaseDomainOutput<K>
    }
    case 'account.revokeOtherSessions': {
      const { userId, currentSessionHash } = input as DatabaseDomainInput<'account.revokeOtherSessions'>
      database.query('DELETE FROM sessions WHERE user_id=? AND token_hash IS NOT ?').run(userId, currentSessionHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'account.storeEmailToken': {
      const { tokenHash, userId, kind, email, expiresAt } = input as DatabaseDomainInput<'account.storeEmailToken'>
      database.transaction(() => {
        database.query('DELETE FROM email_tokens WHERE user_id=? AND kind=?').run(userId, kind)
        database.query('INSERT INTO email_tokens(token_hash,user_id,kind,email,expires_at) VALUES(?,?,?,?,?)')
          .run(tokenHash, userId, kind, email, expiresAt)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'account.deleteEmailToken': {
      database.query('DELETE FROM email_tokens WHERE token_hash=?')
        .run((input as DatabaseDomainInput<'account.deleteEmailToken'>).tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'admin.dashboard': {
      const { status, page } = input as DatabaseDomainInput<'admin.dashboard'>
      const total = (database.query('SELECT count(*) count FROM reports WHERE status=?').get(status) as {
        count: number
      }).count
      const reports = database.query(`SELECT r.id,r.reason,r.status,r.created_at,r.resolved_at,r.post_id,
        p.body post_body,p.deleted_at post_deleted_at,p.user_id author_id,author.handle author_handle,
        reporter.handle reporter_handle,resolver.handle resolver_handle
        FROM reports r JOIN posts p ON p.id=r.post_id JOIN users author ON author.id=p.user_id
        JOIN users reporter ON reporter.id=r.reporter_id LEFT JOIN users resolver ON resolver.id=r.resolved_by
        WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`)
        .all(status, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      const actions = database.query(`SELECT aa.id,aa.action,aa.note,aa.created_at,actor.handle actor_handle,
        aa.target_user_id,target.handle target_handle,aa.target_post_id
        FROM admin_actions aa JOIN users actor ON actor.id=aa.actor_id
        LEFT JOIN users target ON target.id=aa.target_user_id ORDER BY aa.created_at DESC,aa.id DESC LIMIT 20`).all()
      const suspended = database.query(`SELECT id,handle,email,bio,suspended_at,deleted_at FROM users
        WHERE deleted_at IS NULL AND suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 20`).all()
      const illegalReports = database.query(`SELECT * FROM illegal_activity_reports
        WHERE status='open' ORDER BY created_at,id LIMIT 20`).all()
      const day = new Date().toISOString().slice(0, 10)
      const ipRequests = database.query(`SELECT ip_hash hash,substr(ip_hash,1,5) obfuscated,
        request_count requests,blocked_at IS NOT NULL blocked FROM daily_ip_requests
        WHERE day=? ORDER BY request_count DESC,ip_hash LIMIT 50`).all(day)
      return { stats: dashboardStats(database), total, reports, actions, suspended, illegalReports,
        ipRequests } as DatabaseDomainOutput<K>
    }
    case 'admin.blockIp': {
      const { day, hash, actorId } = input as DatabaseDomainInput<'admin.blockIp'>
      const result = database.query(`UPDATE daily_ip_requests SET blocked_at=CURRENT_TIMESTAMP,blocked_by=?
        WHERE day=? AND ip_hash=? AND blocked_at IS NULL`).run(actorId, day, hash)
      return Boolean(result.changes) as DatabaseDomainOutput<K>
    }
    case 'admin.decideIllegalReport': {
      const { id, decision, reasons } = input as DatabaseDomainInput<'admin.decideIllegalReport'>
      const report = database.query(`SELECT reference,reporter_email FROM illegal_activity_reports
        WHERE id=? AND status='open'`).get(id) as { reference: string; reporter_email: string | null } | null
      if (!report) return { status: 'not_open' } as DatabaseDomainOutput<K>
      const updated = database.query(`UPDATE illegal_activity_reports SET status=?,resolution_note=?,
        resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'`)
        .run(decision === 'resolve' ? 'resolved' : 'dismissed', reasons.slice(0, 2000), id)
      return (updated.changes
        ? { status: 'ready', reference: report.reference, reporterEmail: report.reporter_email }
        : { status: 'not_open' }) as DatabaseDomainOutput<K>
    }
    case 'admin.decideReport': {
      const { id, decision, actorId, note } = input as DatabaseDomainInput<'admin.decideReport'>
      const report = database.query('SELECT post_id FROM reports WHERE id=? AND status=\'open\'')
        .get(id) as { post_id: number } | null
      if (!report) return false as DatabaseDomainOutput<K>
      database.transaction(() => {
        database.query(`UPDATE reports SET status=?,resolved_at=CURRENT_TIMESTAMP,resolved_by=?
          WHERE id=? AND status='open'`).run(decision === 'resolve' ? 'resolved' : 'dismissed', actorId, id)
        recordAdminAction(database, actorId, decision === 'resolve' ? 'resolve_report' : 'dismiss_report', null,
          report.post_id, note)
      })()
      return true as DatabaseDomainOutput<K>
    }
    case 'admin.post': {
      const { id } = input as DatabaseDomainInput<'admin.post'>
      return (database.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,u.handle
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL`).get(id)
        || null) as DatabaseDomainOutput<K>
    }
    case 'admin.deletePost': {
      const { id, actorId, note } = input as DatabaseDomainInput<'admin.deletePost'>
      const post = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL').get(id) as {
        user_id: number
      } | null
      if (!post) return { status: 'not_found' } as DatabaseDomainOutput<K>
      let imageKeys: string[] = []
      database.transaction(() => {
        imageKeys = removePreviewRecords(database, post.user_id, id)
        softDeletePost(database, id)
        resolvePostReports(database, id, actorId)
        recordAdminAction(database, actorId, 'delete_post', post.user_id, id, note)
      })()
      return { status: 'ready', imageKeys } as DatabaseDomainOutput<K>
    }
    case 'admin.user': {
      const { id } = input as DatabaseDomainInput<'admin.user'>
      return (database.query(`SELECT id,handle,email,bio,suspended_at,deleted_at,is_bot,bot_managed FROM users
        WHERE id=? AND deleted_at IS NULL`).get(id) || null) as DatabaseDomainOutput<K>
    }
    case 'admin.moderateUser': {
      const { id, actorId, action, isBot, note } = input as DatabaseDomainInput<'admin.moderateUser'>
      const target = database.query(`SELECT id,email,suspended_at,is_bot,bot_managed FROM users
        WHERE id=? AND deleted_at IS NULL`).get(id) as { id: number; email: string; suspended_at: string | null;
        is_bot: number; bot_managed: number } | null
      if (!target) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (action === 'suspend' && target.suspended_at) {
        return { status: 'already_suspended' } as DatabaseDomainOutput<K>
      }
      if (action === 'restore' && !target.suspended_at) return { status: 'not_suspended' } as DatabaseDomainOutput<K>
      if (action === 'bot' && target.bot_managed && Boolean(target.is_bot) === isBot) {
        return { status: 'bot_unchanged' } as DatabaseDomainOutput<K>
      }
      let imageKeys: string[] = []
      database.transaction(() => {
        if (action === 'bot') {
          database.query('UPDATE users SET is_bot=?,bot_managed=1 WHERE id=?').run(isBot ? 1 : 0, id)
          recordAdminAction(database, actorId, isBot ? 'mark_bot' : 'unmark_bot', id, null, note)
        }
        else if (action === 'suspend') {
          database.query('UPDATE users SET suspended_at=CURRENT_TIMESTAMP WHERE id=?').run(id)
          database.query('DELETE FROM sessions WHERE user_id=?').run(id)
          recordAdminAction(database, actorId, 'suspend_user', id, null, note)
        }
        else if (action === 'restore') {
          database.query('UPDATE users SET suspended_at=NULL WHERE id=?').run(id)
          recordAdminAction(database, actorId, 'restore_user', id, null, note)
        }
        else {
          imageKeys = removePreviewRecords(database, id)
          recordAdminAction(database, actorId, 'delete_user', id, null, note)
          anonymizeUser(database, id, actorId)
        }
      })()
      return { status: 'ready', imageKeys } as DatabaseDomainOutput<K>
    }
    case 'stats.dashboard':
      return dashboardStats(database) as DatabaseDomainOutput<K>
    case 'seo.sitemapIndex': {
      const { requestUrl, appUrl } = input as DatabaseDomainInput<'seo.sitemapIndex'>
      return await serialized(sitemapIndex(database, requestUrl, appUrl)) as DatabaseDomainOutput<K>
    }
    case 'seo.sitemapSection': {
      const { requestUrl, file, appUrl } = input as DatabaseDomainInput<'seo.sitemapSection'>
      const response = sitemapSection(database, requestUrl, file, appUrl)
      return (response ? await serialized(response) : null) as DatabaseDomainOutput<K>
    }
    case 'posts.threadReplies': {
      const { parentId, viewerId } = input as DatabaseDomainInput<'posts.threadReplies'>
      return loadThreadReplies(database, parentId, viewerId) as DatabaseDomainOutput<K>
    }
    case 'profiles.bioReferences': {
      const { bio, profileId, viewerId } = input as DatabaseDomainInput<'profiles.bioReferences'>
      return loadBioReferenceData(database, bio, profileId, viewerId) as DatabaseDomainOutput<K>
    }
    case 'profiles.resolve': {
      const resolved = resolveHandle(database, (input as DatabaseDomainInput<'profiles.resolve'>).handle)
      const result = resolved ? { id: resolved.id, handle: resolved.handle, alias: !!resolved.alias } : null
      return result as DatabaseDomainOutput<K>
    }
    case 'posts.detail': {
      const { id, viewerId } = input as DatabaseDomainInput<'posts.detail'>
      const found = database.query('SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?')
        .get(id) as PostView | null
      if (!found) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (viewerId >= 0) {
        const blocked = database.query(`SELECT 1 FROM blocks WHERE
          (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`)
          .get(viewerId, found.user_id, found.user_id, viewerId)
        const blockedTag = database.query(`SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=? AND bh.user_id=?`).get(id, viewerId)
        if (blocked || blockedTag) return { status: 'not_found' } as DatabaseDomainOutput<K>
      }
      const root = found.parent_id
        ? database.query(`WITH RECURSIVE ancestors(id,parent_id,depth) AS (
        SELECT id,parent_id,0 FROM posts WHERE id=? UNION ALL
        SELECT p.id,p.parent_id,ancestors.depth+1 FROM posts p JOIN ancestors ON p.id=ancestors.parent_id
      ) SELECT id FROM ancestors ORDER BY depth DESC LIMIT 1`).get(id) as { id: number } | null
        : null
      return { status: 'ready', post: enrichPosts(database, [found], viewerId)[0],
        conversationRootId: root?.id ?? null } as DatabaseDomainOutput<K>
    }
    case 'posts.editData': {
      const { id, userId } = input as DatabaseDomainInput<'posts.editData'>
      const post = database.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,u.handle
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL`).get(id) as PostView | null
      if (!post) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (post.user_id !== userId) return { status: 'forbidden' } as DatabaseDomainOutput<K>
      const parent = post.parent_id
        ? database.query(`SELECT p.id,p.user_id,p.parent_id,p.body,p.created_at,p.deleted_at,
        p.has_latex,p.has_links,p.has_code,u.handle,u.bio FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`)
          .get(post.parent_id) as PostView | null
        : null
      return { status: 'ready', post, parent } as DatabaseDomainOutput<K>
    }
    case 'posts.replyParent': {
      const { id, userId } = input as DatabaseDomainInput<'posts.replyParent'>
      const post = database.query('SELECT p.*,u.handle,u.bio FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?')
        .get(id) as PostView | null
      if (!post) return { status: 'not_found' } as DatabaseDomainOutput<K>
      const blocked = database.query(`SELECT 1 FROM blocks WHERE
        (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`)
        .get(userId, post.user_id, post.user_id, userId)
      if (blocked) return { status: 'forbidden' } as DatabaseDomainOutput<K>
      return { status: 'ready', post: enrichPosts(database, [post], userId)[0] } as DatabaseDomainOutput<K>
    }
    case 'posts.ogData': {
      const { id } = input as DatabaseDomainInput<'posts.ogData'>
      return (database.query(`SELECT p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.id=? AND p.deleted_at IS NULL`).get(id) || null) as DatabaseDomainOutput<K>
    }
    case 'posts.suggestions': {
      const { kind, query, viewerId } = input as DatabaseDomainInput<'posts.suggestions'>
      const found = kind === 'hashtags'
        ? searchTags(database, query, viewerId, 1, { followedFirst: true })
        : searchPeople(database, query, viewerId, 1, { followedFirst: true, handleOnly: true })
      const results = kind === 'hashtags'
        ? found.rows.map(row => 'tag' in row ? row.tag : '')
        : found.rows.map(row => 'handle' in row ? row.handle : '')
      return { results, truncated: found.total > 20 } as DatabaseDomainOutput<K>
    }
    case 'profiles.overview': {
      const { profileId, viewerId } = input as DatabaseDomainInput<'profiles.overview'>
      const profile = database.query(
        'SELECT id,handle,email,bio,created_at,suspended_at,deleted_at FROM users WHERE id=? AND deleted_at IS NULL',
      ).get(profileId) as import('./types').ProfileRow | null
      if (!profile) return null as DatabaseDomainOutput<K>
      const postCounts = database.query(`SELECT
        (SELECT count(*) FROM posts WHERE user_id=? AND parent_id IS NULL AND deleted_at IS NULL) noteCount,
        (SELECT count(*) FROM posts WHERE user_id=? AND parent_id IS NOT NULL AND deleted_at IS NULL) replyCount`)
        .get(profileId, profileId) as { noteCount: number; replyCount: number }
      const following = viewerId >= 0
        && !!database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(viewerId, profileId)
      const followsViewer = viewerId >= 0
        && !!database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(profileId, viewerId)
      const blocked = viewerId >= 0
        && !!database.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(viewerId, profileId)
      const blockedByProfile = viewerId >= 0
        && !!database.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(profileId, viewerId)
      const counts = database.query(`SELECT
        (SELECT count(*) FROM follows f WHERE following_id=? AND (? < 0 OR NOT EXISTS
          (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.follower_id)
            OR (b.blocker_id=f.follower_id AND b.blocked_id=?)))) followerCount,
        (SELECT count(*) FROM follows f WHERE follower_id=? AND (? < 0 OR NOT EXISTS
          (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.following_id)
            OR (b.blocker_id=f.following_id AND b.blocked_id=?)))) followingCount,
        (SELECT count(*) FROM hashtag_follows WHERE user_id=?) followingTagCount`)
        .get(profileId, viewerId, viewerId, viewerId, profileId, viewerId, viewerId, viewerId, profileId) as {
          followerCount: number
          followingCount: number
          followingTagCount: number
        }
      const blockCounts = viewerId === profileId
        ? database.query(`SELECT (SELECT count(*) FROM blocks WHERE blocker_id=?) blockedPeopleCount,
          (SELECT count(*) FROM blocked_hashtags WHERE user_id=?) blockedTagCount`).get(profileId, profileId) as {
          blockedPeopleCount: number
          blockedTagCount: number
        }
        : { blockedPeopleCount: 0, blockedTagCount: 0 }
      const result = { profile, bioReference: loadBioReferenceData(database, profile.bio, profileId, viewerId),
        ...postCounts, following, followsViewer, blocked, blockedByProfile, ...counts, ...blockCounts }
      return result as DatabaseDomainOutput<K>
    }
    case 'profiles.blockedPage': {
      const { profileId, page } = input as DatabaseDomainInput<'profiles.blockedPage'>
      const people = database.query(`SELECT u.*,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts
        FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=?
        ORDER BY u.handle LIMIT ? OFFSET ?`).all(profileId, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      const tags = database.query(`SELECT bh.tag,0 viewerFollowing,
        (SELECT count(*) FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
          WHERE ph.tag=bh.tag AND p.deleted_at IS NULL) count
        FROM blocked_hashtags bh WHERE bh.user_id=? ORDER BY bh.tag`).all(profileId)
      return { people, tags } as DatabaseDomainOutput<K>
    }
    case 'profiles.connectionsPage': {
      const { profileId, viewerId, page, tagsPage, kind } = input as DatabaseDomainInput<'profiles.connectionsPage'>
      const join = kind === 'following'
        ? 'JOIN follows f ON f.following_id=u.id WHERE f.follower_id=?'
        : 'JOIN follows f ON f.follower_id=u.id WHERE f.following_id=?'
      const people = database.query(
        `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.following_id=u.id) viewerFollowing,
        EXISTS(SELECT 1 FROM follows rv WHERE rv.follower_id=u.id AND rv.following_id=?) followsViewer
        FROM users u ${join} AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
        ORDER BY u.handle LIMIT ? OFFSET ?`,
      ).all(viewerId, viewerId, profileId, viewerId, viewerId, viewerId, CONNECTION_PAGE_SIZE,
        (page - 1) * CONNECTION_PAGE_SIZE)
      const countWhere = kind === 'following' ? 'follower_id=?' : 'following_id=?'
      const counterpart = kind === 'following' ? 'f.following_id' : 'f.follower_id'
      const total = (database.query(`SELECT count(*) count FROM follows f WHERE ${countWhere}
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=${counterpart}) OR (b.blocker_id=${counterpart} AND b.blocked_id=?)))`)
        .get(profileId, viewerId, viewerId, viewerId) as { count: number }).count
      const tags = kind === 'following'
        ? database.query(`SELECT hf.tag,
        (SELECT count(*) FROM post_hashtags ph JOIN posts hp ON hp.id=ph.post_id
          WHERE ph.tag=hf.tag AND hp.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
            (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=hp.user_id)
              OR (b.blocker_id=hp.user_id AND b.blocked_id=?)))) count,
        EXISTS(SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=? AND vhf.tag=hf.tag) viewerFollowing
        FROM hashtag_follows hf WHERE hf.user_id=? ORDER BY hf.tag LIMIT ? OFFSET ?`)
          .all(viewerId, viewerId, viewerId, viewerId, profileId, TAG_PAGE_SIZE, (tagsPage - 1) * TAG_PAGE_SIZE)
        : []
      return { people, tags, total } as DatabaseDomainOutput<K>
    }
    case 'profiles.postsPage': {
      const { profileId, viewerId, page, pageSize, kind } = input as DatabaseDomainInput<'profiles.postsPage'>
      const postKindFilter = kind === 'replies' ? 'AND p.parent_id IS NOT NULL' : 'AND p.parent_id IS NULL'
      const snapshot = feedSnapshotPage<PostView>(database, `profile:${profileId}:${kind}`, viewerId, page,
        () =>
          database.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
          WHERE p.user_id=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS
            (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
              WHERE ph.post_id=p.id AND bh.user_id=?)) ${postKindFilter}
          ORDER BY p.id DESC`).all(profileId, viewerId, viewerId) as PostView[], pageSize)
      return { posts: enrichPosts(database, snapshot.items, viewerId), page: snapshot.page,
        totalItems: snapshot.totalItems, totalPages: snapshot.totalPages } as DatabaseDomainOutput<K>
    }
    case 'syndication.load': {
      const { kind, origin, identifier } = input as DatabaseDomainInput<'syndication.load'>
      if (kind === 'user') {
        const resolved = identifier ? resolveHandle(database, identifier) : null
        if (!resolved) return { status: 'not_found' } as DatabaseDomainOutput<K>
        if (resolved.alias) return { status: 'redirect', handle: resolved.handle } as DatabaseDomainOutput<K>
        return { status: 'ready', handle: resolved.handle,
          posts: apiPosts(database, origin, { limit: API_DEFAULT_LIMIT, before: null, handle: resolved.handle }).data,
          activities: [], postTitlePrefixes: {} } as DatabaseDomainOutput<K>
      }
      if (kind === 'personalized') {
        const viewer = identifier ? userForFeedKey(database, identifier) : null
        if (!viewer) return { status: 'not_found' } as DatabaseDomainOutput<K>
        const feed = apiActivities(database, origin, viewer, { limit: 100, cursor: null, toMe: false })
        const posts = feed.data.flatMap(activity =>
          ['post', 'reply', 'mention'].includes(activity.type) && 'body' in activity.payload ? [activity.payload] : []
        )
        const postTitlePrefixes = Object.fromEntries(
          feed.data.flatMap(activity =>
            activity.type === 'mention' && 'body' in activity.payload ? [[activity.payload.id, 'Mentioned you: ']] : []
          ),
        )
        const activities = feed.data.flatMap(activity => {
          if (['post', 'reply', 'mention'].includes(activity.type) || 'body' in activity.payload) return []
          const { actor, target } = activity.payload
          const title = activity.type === 'signup'
            ? `@${actor.handle} signed up`
            : target && 'handle' in target
            ? `@${actor.handle} followed @${target.handle}`
            : target && 'tag' in target
            ? `@${actor.handle} followed #${target.tag}`
            : `@${actor.handle} followed someone`
          return [{ id: `${origin}/activities/${encodeURIComponent(activity.id)}`, title, url: target?.url || actor.url,
            created_at: activity.created_at, author: actor }]
        })
        return { status: 'ready', viewerHandle: viewer.handle, posts, activities,
          postTitlePrefixes } as DatabaseDomainOutput<K>
      }
      const posts = kind === 'hot'
        ? apiHotPosts(database, origin, API_DEFAULT_LIMIT, null).data
        : apiPosts(database, origin, { limit: API_DEFAULT_LIMIT, before: null,
          ...(kind === 'latest' ? { excludeBots: true } : { tag: identifier || '' }) }).data
      return { status: 'ready', posts, activities: [], postTitlePrefixes: {} } as DatabaseDomainOutput<K>
    }
    case 'api.publicRead': {
      const request = input as DatabaseDomainInput<'api.publicRead'>
      if (request.kind === 'collection') {
        const { kind: _, origin, ...options } = request
        return { status: 'ready', value: apiPosts(database, origin, options) } as DatabaseDomainOutput<K>
      }
      if (request.kind === 'hot') {
        const result = { status: 'ready' as const,
          value: apiHotPosts(database, request.origin, request.limit, request.cursor) }
        return result as DatabaseDomainOutput<K>
      }
      if (request.kind === 'search') {
        const result = { status: 'ready' as const,
          value: apiSearchPosts(database, request.origin, request.query, request.limit, request.offset) }
        return result as DatabaseDomainOutput<K>
      }
      if (request.kind === 'post') {
        const post = apiPost(database, request.id, request.origin)
        return post
          ? { status: 'ready', value: { data: post } } as DatabaseDomainOutput<K>
          : { status: 'not_found' } as DatabaseDomainOutput<K>
      }
      if (!apiPost(database, request.id, request.origin)) {
        return { status: 'not_found' } as DatabaseDomainOutput<K>
      }
      return { status: 'ready', value: apiReplies(database, request.origin, request.id, {
        limit: request.limit,
        before: request.before,
        depth: request.depth,
      }) } as DatabaseDomainOutput<K>
    }
    case 'api.activities': {
      const request = input as DatabaseDomainInput<'api.activities'>
      return apiActivities(database, request.origin, request.user, { limit: request.limit, cursor: request.cursor,
        toMe: request.toMe }) as DatabaseDomainOutput<K>
    }
    case 'api.markActivitiesRead': {
      const { userId, activityIds, toMe } = input as DatabaseDomainInput<'api.markActivitiesRead'>
      return markVisibleForYouEntriesRead(userId, activityIds, toMe, database) as DatabaseDomainOutput<K>
    }
    case 'api.markAllActivitiesRead': {
      const { userId, toMe } = input as DatabaseDomainInput<'api.markAllActivitiesRead'>
      markAllForYouRead(userId, toMe, database)
      return null as DatabaseDomainOutput<K>
    }
    case 'api.profile': {
      const { handle, viewerId, origin } = input as DatabaseDomainInput<'api.profile'>
      const resolved = resolveHandle(database, handle)
      if (!resolved) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (resolved.alias) return { status: 'redirect', handle: resolved.handle } as DatabaseDomainOutput<K>
      const found = database.query(`SELECT u.handle,u.bio,u.created_at,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.parent_id IS NULL
          AND p.deleted_at IS NULL) post_count,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.parent_id IS NOT NULL
          AND p.deleted_at IS NULL) replies_count,
        (SELECT count(*) FROM follows f JOIN users follower ON follower.id=f.follower_id
          WHERE f.following_id=u.id AND follower.deleted_at IS NULL
            AND follower.suspended_at IS NULL) follower_count,
        (SELECT count(*) FROM follows f JOIN users followed ON followed.id=f.following_id
          WHERE f.follower_id=u.id AND followed.deleted_at IS NULL
            AND followed.suspended_at IS NULL) following_user_count,
        (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) following_tag_count
        FROM users u WHERE u.id=? AND u.deleted_at IS NULL`).get(resolved.id) as {
        handle: string
        bio: string
        created_at: string
        post_count: number
        replies_count: number
        follower_count: number
        following_user_count: number
        following_tag_count: number
      } | null
      if (!found) return { status: 'not_found' } as DatabaseDomainOutput<K>
      const blockCounts = viewerId === resolved.id
        ? database.query(`SELECT
        (SELECT count(*) FROM blocks WHERE blocker_id=?) blocked_user_count,
        (SELECT count(*) FROM blocked_hashtags WHERE user_id=?) blocked_tag_count`)
          .get(resolved.id, resolved.id)
        : null
      const normalized = found.handle.toLowerCase()
      const value = {
        data: { handle: normalized, bio: found.bio,
          created_at: new Date(found.created_at.replace(' ', 'T') + 'Z').toISOString(), post_count: found.post_count,
          replies_count: found.replies_count, follower_count: found.follower_count,
          following_user_count: found.following_user_count, following_tag_count: found.following_tag_count,
          following_count: found.following_user_count, ...(blockCounts || {}),
          url: `${origin}/u/${encodeURIComponent(normalized)}`,
          api_url: `${origin}/api/v1/users/${encodeURIComponent(normalized)}` },
      }
      return { status: 'ready', value, private: !!blockCounts } as DatabaseDomainOutput<K>
    }
    case 'api.tagDetails': {
      const { tag, origin } = input as DatabaseDomainInput<'api.tagDetails'>
      const counts = database.query(`SELECT
        (SELECT count(*) FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
          JOIN users author ON author.id=p.user_id WHERE ph.tag=? AND p.deleted_at IS NULL
            AND author.deleted_at IS NULL AND author.suspended_at IS NULL) post_count,
        (SELECT count(*) FROM hashtag_follows hf JOIN users follower ON follower.id=hf.user_id
          WHERE hf.tag=? AND follower.deleted_at IS NULL AND follower.suspended_at IS NULL) follower_count`)
        .get(tag, tag) as { post_count: number; follower_count: number }
      if (!counts.post_count && !counts.follower_count) {
        return { status: 'not_found' } as DatabaseDomainOutput<K>
      }
      return { status: 'ready', value: {
        data: { tag, ...counts, url: `${origin}/tag/${encodeURIComponent(tag)}`,
          api_url: `${origin}/api/v1/tags/${encodeURIComponent(tag)}` },
      } } as DatabaseDomainOutput<K>
    }
    case 'api.relationships': {
      const request = input as DatabaseDomainInput<'api.relationships'>
      let accountId: number | null = null
      if (request.kind !== 'tagFollowers') {
        const resolved = request.handle ? resolveHandle(database, request.handle) : null
        if (!resolved) return { status: 'not_found' } as DatabaseDomainOutput<K>
        if (resolved.alias) return { status: 'redirect', handle: resolved.handle } as DatabaseDomainOutput<K>
        accountId = resolved.id
        if (request.kind === 'blocks' && request.viewerId !== accountId) {
          return { status: 'forbidden' } as DatabaseDomainOutput<K>
        }
      }
      const cursorFilter = request.before === null ? '' : 'AND related.id < ?'
      const cursorParameters = request.before === null ? [] : [request.before]
      if (request.kind === 'followingTags') {
        const before = request.before === null ? '' : 'AND hf.rowid < ?'
        const rows = database.query(`SELECT hf.rowid id,hf.tag,
          (SELECT count(*) FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
            JOIN users author ON author.id=p.user_id WHERE ph.tag=hf.tag AND p.deleted_at IS NULL
              AND author.deleted_at IS NULL AND author.suspended_at IS NULL) post_count,
          (SELECT count(*) FROM hashtag_follows followers JOIN users follower ON follower.id=followers.user_id
            WHERE followers.tag=hf.tag AND follower.deleted_at IS NULL
              AND follower.suspended_at IS NULL) follower_count
          FROM hashtag_follows hf WHERE hf.user_id=? ${before} ORDER BY hf.rowid DESC LIMIT ?`)
          .all(accountId!, ...cursorParameters, request.limit + 1) as Array<{
            id: number
            tag: string
            post_count: number
            follower_count: number
          }>
        const selected = rows.slice(0, request.limit)
        const value = {
          data: selected.map(row => ({ tag: row.tag, post_count: row.post_count, follower_count: row.follower_count,
            url: `${request.origin}/tag/${encodeURIComponent(row.tag)}`,
            api_url: `${request.origin}/api/v1/tags/${encodeURIComponent(row.tag)}` })
          ),
          pagination: { next_cursor: rows.length > request.limit
            ? encodeCursor(selected[selected.length - 1].id)
            : null },
        }
        return { status: 'ready', value } as DatabaseDomainOutput<K>
      }
      let rows: Array<{ id: number; handle: string }>
      if (request.kind === 'blocks') {
        rows = database.query(`SELECT related.id,related.handle FROM blocks b
          JOIN users related ON related.id=b.blocked_id WHERE b.blocker_id=?
            AND related.deleted_at IS NULL ${cursorFilter} ORDER BY related.id DESC LIMIT ?`)
          .all(accountId!, ...cursorParameters, request.limit + 1) as typeof rows
      }
      else if (request.kind === 'tagFollowers') {
        rows = database.query(`SELECT related.id,related.handle FROM hashtag_follows hf
          JOIN users related ON related.id=hf.user_id WHERE hf.tag=?
            AND related.deleted_at IS NULL AND related.suspended_at IS NULL ${cursorFilter}
          ORDER BY related.id DESC LIMIT ?`).all(request.tag!, ...cursorParameters, request.limit + 1) as typeof rows
      }
      else {
        const join = request.kind === 'following'
          ? 'JOIN users related ON related.id=f.following_id WHERE f.follower_id=?'
          : 'JOIN users related ON related.id=f.follower_id WHERE f.following_id=?'
        rows = database.query(`SELECT related.id,related.handle FROM follows f ${join}
          AND related.deleted_at IS NULL AND related.suspended_at IS NULL ${cursorFilter}
          ORDER BY related.id DESC LIMIT ?`).all(accountId!, ...cursorParameters, request.limit + 1) as typeof rows
      }
      const selected = rows.slice(0, request.limit)
      const value = { data: selected.map(row => {
        const handle = row.handle.toLowerCase()
        return { handle, url: `${request.origin}/u/${encodeURIComponent(handle)}`,
          api_url: `${request.origin}/api/v1/users/${encodeURIComponent(handle)}` }
      }), pagination: { next_cursor: rows.length > request.limit
        ? encodeCursor(selected[selected.length - 1].id)
        : null } }
      return { status: 'ready', value } as DatabaseDomainOutput<K>
    }
    case 'api.embedExample': {
      const sample = database.query(`SELECT p.id,
        (SELECT ph.tag FROM post_hashtags ph WHERE ph.post_id=p.id ORDER BY ph.tag LIMIT 1) tag
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY p.id DESC LIMIT 1`)
        .get() as { id: number; tag: string | null } | null
      const fallbackTag = sample?.tag || (database.query(`SELECT ph.tag FROM post_hashtags ph
        JOIN posts p ON p.id=ph.post_id JOIN users u ON u.id=p.user_id
        WHERE p.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY p.id DESC LIMIT 1`)
        .get() as { tag: string } | null)?.tag
        || null
      return { postId: sample?.id || null, tag: fallbackTag } as DatabaseDomainOutput<K>
    }
    case 'api.relationshipMutation': {
      const { userId, handle, action } = input as DatabaseDomainInput<'api.relationshipMutation'>
      const target = resolveHandle(database, handle)
      if (!target) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (target.id === userId) return { status: 'self' } as DatabaseDomainOutput<K>
      if (action === 'follow') {
        const blocked = database.query(`SELECT 1 FROM blocks WHERE
          (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`)
          .get(userId, target.id, target.id, userId)
        if (blocked) return { status: 'blocked' } as DatabaseDomainOutput<K>
      }
      let changed = false
      if (action === 'follow') {
        changed = database.query(`INSERT OR IGNORE INTO follows(follower_id,following_id,created_at)
          VALUES(?,?,CURRENT_TIMESTAMP)`).run(userId, target.id).changes > 0
      }
      else if (action === 'unfollow') {
        changed = database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?')
          .run(userId, target.id).changes > 0
      }
      else if (action === 'block') {
        changed = database.transaction(() => {
          const inserted = database.query('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id) VALUES(?,?)')
            .run(userId, target.id).changes > 0
          database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(userId, target.id)
          return inserted
        })()
      }
      else {
        changed = database.query('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?')
          .run(userId, target.id).changes > 0
      }
      const result = { status: 'ready' as const, changed, targetId: target.id, targetHandle: target.handle }
      return result as DatabaseDomainOutput<K>
    }
    case 'api.createPost': {
      const { userId, body, parentId, origin } = input as DatabaseDomainInput<'api.createPost'>
      if (parentId !== null) {
        const parent = database.query('SELECT user_id FROM posts WHERE id=? AND deleted_at IS NULL')
          .get(parentId) as { user_id: number } | null
        if (!parent) return { status: 'not_found' } as DatabaseDomainOutput<K>
        const blocked = database.query(`SELECT 1 FROM blocks WHERE
          (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`)
          .get(userId, parent.user_id, parent.user_id, userId)
        if (blocked) return { status: 'not_found' } as DatabaseDomainOutput<K>
      }
      const created = createPost(database, userId, body, parentId, false)
      if ('retryAfter' in created) {
        return { status: 'rate_limited', retryAfter: created.retryAfter } as DatabaseDomainOutput<K>
      }
      return { status: 'ready', id: created.id, duplicate: created.duplicate,
        post: apiPost(database, created.id, origin)! } as DatabaseDomainOutput<K>
    }
    case 'api.updatePost': {
      const { userId, id, body, origin } = input as DatabaseDomainInput<'api.updatePost'>
      const existing = database.query('SELECT user_id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL')
        .get(id) as { user_id: number; parent_id: number | null } | null
      if (!existing) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (existing.user_id !== userId) return { status: 'forbidden' } as DatabaseDomainOutput<K>
      updatePost(database, id, body)
      return { status: 'ready', post: apiPost(database, id, origin)! } as DatabaseDomainOutput<K>
    }
    case 'api.deletePost': {
      const { userId, id } = input as DatabaseDomainInput<'api.deletePost'>
      const existing = database.query('SELECT user_id,parent_id FROM posts WHERE id=? AND deleted_at IS NULL')
        .get(id) as { user_id: number; parent_id: number | null } | null
      if (!existing) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (existing.user_id !== userId) return { status: 'forbidden' } as DatabaseDomainOutput<K>
      const available = database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
      )
        .get()
      const imageKeys = available
        ? (database.query('SELECT image_url FROM post_link_previews WHERE post_id=?')
          .all(id) as { image_url: string }[]).map(row => row.image_url).filter(isImageKey)
        : []
      database.transaction(() => {
        softDeletePost(database, id)
        if (available) database.query('DELETE FROM post_link_previews WHERE post_id=?').run(id)
      })()
      return { status: 'ready', imageKeys, parentId: existing.parent_id } as DatabaseDomainOutput<K>
    }
    case 'api.persistPostPreviews': {
      const { postId, mode, previews } = input as DatabaseDomainInput<'api.persistPostPreviews'>
      const available = database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'post_link_previews\'',
      )
        .get()
      if (!available) return { obsoleteImageKeys: [] } as DatabaseDomainOutput<K>
      const existingRows = database.query('SELECT url,image_url FROM post_link_previews WHERE post_id=?')
        .all(postId) as { url: string; image_url: string }[]
      const oldKeys = existingRows.map(row => row.image_url).filter(isImageKey)
      const newKeys = previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : [])
      database.transaction(() => {
        if (mode === 'replace') database.query('DELETE FROM post_link_previews WHERE post_id=?').run(postId)
        const insert = database.query(`INSERT INTO post_link_previews
          (post_id,url,image_url,title,description,site_name,image_width,image_height) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(post_id,url) DO UPDATE SET image_url=excluded.image_url,title=excluded.title,
            description=excluded.description,site_name=excluded.site_name,image_width=excluded.image_width,
            image_height=excluded.image_height`)
        for (const preview of previews) {
          insert.run(postId, preview.url, preview.imageKey || preview.imageUrl, preview.title || null,
            preview.description || null, preview.siteName || null, preview.imageWidth || null,
            preview.imageHeight || null)
        }
      })()
      const retained = mode === 'save'
        ? existingRows.filter(row => previews.every(preview => preview.url !== row.url))
          .map(row => row.image_url).filter(isImageKey)
        : []
      const result = { obsoleteImageKeys: oldKeys.filter(key => !newKeys.includes(key) && !retained.includes(key)) }
      return result as DatabaseDomainOutput<K>
    }
    case 'api.updateBio': {
      const { userId, bio } = input as DatabaseDomainInput<'api.updateBio'>
      database.query('UPDATE users SET bio=? WHERE id=?').run(bio, userId)
      return null as DatabaseDomainOutput<K>
    }
    case 'api.persistBioPreviews': {
      const { userId, previews } = input as DatabaseDomainInput<'api.persistBioPreviews'>
      const available = database.query(
        'SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\'user_bio_link_previews\'',
      ).get()
      if (!available) return { obsoleteImageKeys: [] } as DatabaseDomainOutput<K>
      const oldKeys = (database.query('SELECT image_url FROM user_bio_link_previews WHERE user_id=?')
        .all(userId) as { image_url: string }[]).map(row => row.image_url).filter(isImageKey)
      const newKeys = previews.flatMap(preview => preview.imageKey ? [preview.imageKey] : [])
      database.transaction(() => {
        database.query('DELETE FROM user_bio_link_previews WHERE user_id=?').run(userId)
        const insert = database.query(`INSERT INTO user_bio_link_previews
          (user_id,url,image_url,title,description,site_name,image_width,image_height) VALUES(?,?,?,?,?,?,?,?)`)
        for (const preview of previews) {
          insert.run(userId, preview.url, preview.imageKey || preview.imageUrl, preview.title || null,
            preview.description || null, preview.siteName || null, preview.imageWidth || null,
            preview.imageHeight || null)
        }
      })()
      return { obsoleteImageKeys: oldKeys.filter(key => !newKeys.includes(key)) } as DatabaseDomainOutput<K>
    }
    case 'api.requestSignIn': {
      const { email, origin, now } = input as DatabaseDomainInput<'api.requestSignIn'>
      const account = accountForEmail(database, email)
      if (!account?.handle_chosen_at) return null as DatabaseDomainOutput<K>
      const value = randomBytes(32).toString('hex')
      const code = String(randomInt(100000, 1000000))
      database.transaction(() => {
        database.query('DELETE FROM magic_links WHERE email=? OR expires_at<=?').run(email, now)
        database.query(`INSERT INTO magic_links(token_hash,email,user_id,next_path,expires_at,created_at,code_hash)
          VALUES(?,?,?,?,?,?,?)`).run(createHash('sha256').update(value).digest('hex'), email, account.id, '/',
          now + 15 * 60 * 1000, now, createHash('sha256').update(code).digest('hex'))
      })()
      const result = { email, handle: account.handle,
        url: `${origin.replace(/\/$/, '')}/enter/magic?token=${encodeURIComponent(value)}`, code }
      return result as DatabaseDomainOutput<K>
    }
    case 'auth.storeMagicLink': {
      const { tokenHash, codeHash, email, userId, nextPath, expiresAt, now } = input as DatabaseDomainInput<
        'auth.storeMagicLink'
      >
      database.transaction(() => {
        database.query('DELETE FROM magic_links WHERE email=? OR expires_at<=?').run(email, now)
        database.query(`INSERT INTO magic_links(token_hash,email,user_id,next_path,expires_at,created_at,code_hash)
          VALUES(?,?,?,?,?,?,?)`).run(tokenHash, email, userId, nextPath, expiresAt, now, codeHash)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'auth.deleteMagicLink': {
      const { tokenHash } = input as DatabaseDomainInput<'auth.deleteMagicLink'>
      database.query('DELETE FROM magic_links WHERE token_hash=?').run(tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'auth.consumeMagicLink': {
      const { selector, userAgent, now, currentUserId } = input as DatabaseDomainInput<'auth.consumeMagicLink'>
      const link = ('tokenHash' in selector
        ? database.query(`SELECT token_hash,email,user_id,next_path,attempts FROM magic_links
          WHERE token_hash=? AND expires_at>?`).get(selector.tokenHash, now)
        : database.query(`SELECT token_hash,email,user_id,next_path,attempts FROM magic_links
          WHERE email=? AND code_hash IS NOT NULL AND expires_at>?`).get(selector.email, now)) as {
          token_hash: string
          email: string
          user_id: number | null
          next_path: string
          attempts: number
        } | null
      if (!link || (currentUserId !== undefined && link.user_id !== currentUserId)
        || ('codeHash' in selector && !database.query(
          'SELECT 1 FROM magic_links WHERE token_hash=? AND code_hash=?',
        ).get(link.token_hash, selector.codeHash)))
      {
        if (link && 'codeHash' in selector) {
          const attempts = link.attempts + 1
          if (attempts >= 5) database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
          else database.query('UPDATE magic_links SET attempts=? WHERE token_hash=?').run(attempts, link.token_hash)
        }
        return { status: 'invalid' } as DatabaseDomainOutput<K>
      }
      const newAccount = !link.user_id
      let userId = link.user_id
      let chosen = true
      const session = randomBytes(32).toString('hex')
      try {
        database.transaction(() => {
          database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
          if (userId) {
            const account = database.query(`SELECT handle_chosen_at FROM users
              WHERE id=? AND deleted_at IS NULL AND suspended_at IS NULL`).get(userId) as {
              handle_chosen_at: string | null
            } | null
            if (!account) throw new Error('Account is unavailable')
            chosen = Boolean(account.handle_chosen_at)
            markGroupEmailVerified(database, userId)
            if (!selectAccount(database, userId)) throw new Error('Account is unavailable')
          }
          else {
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const handle = `anon${randomBytes(8).toString('hex').slice(0, 12)}`
                const created = database.query(`INSERT INTO users(handle,email,password,email_verified_at)
                  VALUES(?,?,'!',CURRENT_TIMESTAMP) RETURNING id`).get(handle, link.email) as { id: number }
                userId = created.id
                createAccountGroup(database, userId, link.email)
                chosen = false
                break
              }
              catch (error) {
                if (database.query('SELECT id FROM users WHERE email=?').get(link.email)) throw error
              }
            }
            if (!userId) throw new Error('Could not allocate temporary handle')
          }
          insertSession(database, session, userId!, now + SESSION_LIFETIME_MS, now, userAgent)
        })()
      }
      catch {
        return { status: 'unavailable' } as DatabaseDomainOutput<K>
      }
      const nextPath = newAccount && link.next_path === '/' ? '/explore?welcome=1' : link.next_path
      return { status: 'ready', session, destination: chosen
        ? nextPath
        : `/choose-handle?next=${encodeURIComponent(nextPath)}` } as DatabaseDomainOutput<K>
    }
    case 'auth.preparePasswordReset': {
      const { identifier, isEmail, tokenHash, expiresAt, now } = input as DatabaseDomainInput<
        'auth.preparePasswordReset'
      >
      const account = isEmail
        ? accountForEmail(database, identifier)
        : database.query(`SELECT id,email,password FROM users WHERE handle=? AND deleted_at IS NULL
          AND suspended_at IS NULL`).get(identifier) as { id: number; email: string; password: string } | null
      if (!account || account.password === '!') return null as DatabaseDomainOutput<K>
      database.transaction(() => {
        database.query('DELETE FROM password_resets WHERE user_id=? OR expires_at<=?').run(account.id, now)
        database.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)')
          .run(tokenHash, account.id, expiresAt)
      })()
      return { email: account.email } as DatabaseDomainOutput<K>
    }
    case 'auth.deletePasswordReset': {
      const { tokenHash } = input as DatabaseDomainInput<'auth.deletePasswordReset'>
      database.query('DELETE FROM password_resets WHERE token_hash=?').run(tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'auth.passwordResetValid': {
      const { tokenHash, now } = input as DatabaseDomainInput<'auth.passwordResetValid'>
      return Boolean(database.query('SELECT 1 FROM password_resets WHERE token_hash=? AND expires_at>?')
        .get(tokenHash, now)) as DatabaseDomainOutput<K>
    }
    case 'auth.consumePasswordReset': {
      const { tokenHash, passwordHash, now } = input as DatabaseDomainInput<'auth.consumePasswordReset'>
      const reset = database.query('SELECT user_id FROM password_resets WHERE token_hash=? AND expires_at>?')
        .get(tokenHash, now) as { user_id: number } | null
      if (!reset) return false as DatabaseDomainOutput<K>
      database.transaction(() => {
        database.query('UPDATE users SET password=? WHERE id=?').run(passwordHash, reset.user_id)
        database.query('DELETE FROM password_resets WHERE user_id=?').run(reset.user_id)
        database.query('DELETE FROM sessions WHERE user_id=?').run(reset.user_id)
      })()
      return true as DatabaseDomainOutput<K>
    }
    case 'auth.logout': {
      const { tokenHash } = input as DatabaseDomainInput<'auth.logout'>
      database.query('DELETE FROM sessions WHERE token_hash=?').run(tokenHash)
      return null as DatabaseDomainOutput<K>
    }
    case 'auth.accountForIdentifier': {
      const { identifier, isEmail } = input as DatabaseDomainInput<'auth.accountForIdentifier'>
      const account = isEmail
        ? accountForEmail(database, identifier)
        : database.query(`SELECT id,email,handle,password,handle_chosen_at FROM users WHERE handle=?
          AND deleted_at IS NULL AND suspended_at IS NULL`).get(identifier) as {
          id: number
          email: string
          handle: string
          password: string
          handle_chosen_at: string | null
        } | null
      if (!account) return null as DatabaseDomainOutput<K>
      return { id: account.id, email: account.email, handle: account.handle, password: account.password,
        handleChosenAt: account.handle_chosen_at } as DatabaseDomainOutput<K>
    }
    case 'auth.completePasswordLogin': {
      const { userId, replacementPasswordHash, userAgent, now } = input as DatabaseDomainInput<
        'auth.completePasswordLogin'
      >
      const session = randomBytes(32).toString('hex')
      database.transaction(() => {
        if (replacementPasswordHash) {
          database.query('UPDATE users SET password=? WHERE id=?').run(replacementPasswordHash, userId)
        }
        if (!selectAccount(database, userId)) throw new Error('Account is unavailable')
        insertSession(database, session, userId, now + SESSION_LIFETIME_MS, now, userAgent)
      })()
      return { session } as DatabaseDomainOutput<K>
    }
    case 'auth.passwordLoginChallenge': {
      const { address, now, forceCaptcha } = input as DatabaseDomainInput<'auth.passwordLoginChallenge'>
      const result = { nonce: issuePasswordLoginNonce(database, address, now),
        captcha: forceCaptcha || passwordCaptchaRequired(database, now)
          ? issuePasswordCaptcha(database, now)
          : undefined }
      return result as DatabaseDomainOutput<K>
    }
    case 'auth.validatePasswordLoginForm': {
      const { address, nonce, captchaToken, captchaAnswer, now } = input as DatabaseDomainInput<
        'auth.validatePasswordLoginForm'
      >
      if (!consumePasswordLoginNonce(database, nonce, address, now)) {
        return { status: 'invalid_nonce' } as DatabaseDomainOutput<K>
      }
      if (passwordCaptchaRequired(database, now)
        && !consumePasswordCaptcha(database, captchaToken, captchaAnswer, now))
      {
        return { status: 'invalid_captcha' } as DatabaseDomainOutput<K>
      }
      return { status: 'ready' } as DatabaseDomainOutput<K>
    }
    case 'auth.recordFailedPassword': {
      const { now } = input as DatabaseDomainInput<'auth.recordFailedPassword'>
      return recordFailedPassword(database, now) as DatabaseDomainOutput<K>
    }
    case 'auth.claimInitialHandle': {
      const { userId, handle } = input as DatabaseDomainInput<'auth.claimInitialHandle'>
      try {
        claimInitialHandle(database, userId, handle, reclaimed => {
          const group = accountGroupForUser(database, userId)
          if (!group || group.primary_user_id === userId || reclaimed) return
          if (recentAccountCreations(database, group.id) >= MONTHLY_NEW_ACCOUNT_LIMIT) {
            throw new Error('monthly-account-limit')
          }
          database.query('INSERT INTO account_creation_events(account_group_id,user_id) VALUES(?,?)')
            .run(group.id, userId)
        })
        return { status: 'ready' } as DatabaseDomainOutput<K>
      }
      catch (error) {
        return { status: error instanceof Error && error.message === 'monthly-account-limit'
          ? 'monthly_limit'
          : 'unavailable' } as DatabaseDomainOutput<K>
      }
    }
    case 'api.verifySignIn': {
      const { email, code, userAgent, now } = input as DatabaseDomainInput<'api.verifySignIn'>
      const link = database.query(`SELECT token_hash,user_id,attempts FROM magic_links
        WHERE email=? AND code_hash IS NOT NULL AND expires_at>?`).get(email, now) as {
        token_hash: string
        user_id: number | null
        attempts: number
      } | null
      const match = link && database.query('SELECT 1 FROM magic_links WHERE token_hash=? AND code_hash=?')
        .get(link.token_hash, createHash('sha256').update(code).digest('hex'))
      const accountReady = link?.user_id && database.query(`SELECT 1 FROM users WHERE id=?
        AND handle_chosen_at IS NOT NULL AND deleted_at IS NULL AND suspended_at IS NULL`).get(link.user_id)
      if (!link || !link.user_id || !accountReady || !match) {
        if (link) {
          const attempts = link.attempts + 1
          if (attempts >= 5) database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
          else database.query('UPDATE magic_links SET attempts=? WHERE token_hash=?').run(attempts, link.token_hash)
        }
        return { status: 'invalid' } as DatabaseDomainOutput<K>
      }
      const token = randomBytes(32).toString('hex')
      const expiresAt = now + SESSION_LIFETIME_MS
      database.transaction(() => {
        database.query('DELETE FROM magic_links WHERE token_hash=?').run(link.token_hash)
        markGroupEmailVerified(database, link.user_id!)
        if (!selectAccount(database, link.user_id!)) throw new Error('Account is unavailable')
        insertSession(database, token, link.user_id!, expiresAt, now, userAgent)
      })()
      const user = database.query('SELECT id,handle,email,bio,email_verified_at FROM users WHERE id=?')
        .get(link.user_id) as User
      return { status: 'ready', token, expiresAt, user } as DatabaseDomainOutput<K>
    }
    case 'push.postDelivery': {
      const { postId, actorId } = input as DatabaseDomainInput<'push.postDelivery'>
      const row = database.query(`SELECT child.body,child.parent_id parentId,parent_user.handle parentHandle
        FROM posts child LEFT JOIN posts parent ON parent.id=child.parent_id
        LEFT JOIN users parent_user ON parent_user.id=parent.user_id WHERE child.id=?`).get(postId) as {
        body: string
        parentId: number | null
        parentHandle: string | null
      } | null
      if (!row) return { post: null, subscriptions: [] } as DatabaseDomainOutput<K>
      const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,ps.user_id userId,
        recipient.handle recipientHandle,
        (ps.user_id!=? AND EXISTS(SELECT 1 FROM posts child JOIN posts parent ON parent.id=child.parent_id
          WHERE child.id=? AND parent.user_id=ps.user_id)) isReply,
        (ps.user_id!=? AND EXISTS(SELECT 1 FROM post_mentions pm
          WHERE pm.post_id=? AND pm.user_id=ps.user_id)) isMention,
        ps.notify_replies notifyReplies,ps.notify_mentions notifyMentions
        FROM push_subscriptions ps JOIN users recipient ON recipient.id=ps.user_id
        WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=ps.user_id) OR (b.blocker_id=ps.user_id AND b.blocked_id=?))
        AND NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=? AND bh.user_id=ps.user_id)
        AND (ps.notify_bots=1 OR NOT EXISTS (SELECT 1 FROM users actor WHERE actor.id=? AND actor.is_bot=1))
        AND ((ps.notify_latest=1 AND ps.user_id!=?) OR (ps.notify_following_notes=1 AND ps.user_id!=? AND (EXISTS
          (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
          (SELECT 1 FROM post_hashtags ph JOIN hashtag_follows hf ON hf.tag=ph.tag
            WHERE ph.post_id=? AND hf.user_id=ps.user_id))
          AND (ps.notify_following_only_to_me=0 OR EXISTS(SELECT 1 FROM posts direct_child
            JOIN posts direct_parent ON direct_parent.id=direct_child.parent_id
            WHERE direct_child.id=? AND direct_parent.user_id=ps.user_id) OR EXISTS(
            SELECT 1 FROM post_mentions direct_mention
            WHERE direct_mention.post_id=? AND direct_mention.user_id=ps.user_id)))
          OR (ps.notify_replies=1 AND ps.user_id!=? AND EXISTS(SELECT 1 FROM posts child
            JOIN posts parent ON parent.id=child.parent_id WHERE child.id=? AND parent.user_id=ps.user_id))
          OR (ps.notify_mentions=1 AND ps.user_id!=? AND EXISTS(SELECT 1 FROM post_mentions pm
            WHERE pm.post_id=? AND pm.user_id=ps.user_id)))
        ORDER BY ps.endpoint,isReply DESC,isMention DESC,ps.user_id`)
        .all(actorId, postId, actorId, postId, actorId, actorId, postId, actorId, actorId, actorId, actorId, postId,
          postId, postId, actorId, postId, actorId, postId)
      return { post: row, subscriptions } as DatabaseDomainOutput<K>
    }
    case 'push.followDelivery': {
      const { followedId } = input as DatabaseDomainInput<'push.followDelivery'>
      return database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth,u.handle recipientHandle
        FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
        WHERE ps.user_id=? AND ps.notify_follows=1`).all(followedId) as DatabaseDomainOutput<K>
    }
    case 'push.userFollowDelivery': {
      const { actorId, targetId } = input as DatabaseDomainInput<'push.userFollowDelivery'>
      return database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
        WHERE ps.notify_follow_activity=1 AND ps.user_id NOT IN (?,?)
          AND EXISTS (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?)
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
            b.blocker_id=ps.user_id AND b.blocked_id IN (?,?) OR
            b.blocked_id=ps.user_id AND b.blocker_id IN (?,?))`)
        .all(actorId, targetId, actorId, actorId, targetId, actorId, targetId) as DatabaseDomainOutput<K>
    }
    case 'push.removeEndpoint': {
      database.query('DELETE FROM push_subscriptions WHERE endpoint=?')
        .run((input as DatabaseDomainInput<'push.removeEndpoint'>).endpoint)
      return null as DatabaseDomainOutput<K>
    }
    case 'push.userDelivery': {
      const { userId } = input as DatabaseDomainInput<'push.userDelivery'>
      const subscriptions = database.query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?')
        .all(userId)
      return subscriptions as DatabaseDomainOutput<K>
    }
    case 'push.tagFollowDelivery': {
      const { actorId, tag } = input as DatabaseDomainInput<'push.tagFollowDelivery'>
      return database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
        WHERE ps.notify_follow_activity=1 AND ps.user_id!=? AND (EXISTS
          (SELECT 1 FROM follows vf WHERE vf.follower_id=ps.user_id AND vf.following_id=?) OR EXISTS
          (SELECT 1 FROM hashtag_follows vhf WHERE vhf.user_id=ps.user_id AND vhf.tag=?))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=ps.user_id AND b.blocked_id=?) OR (b.blocked_id=ps.user_id AND b.blocker_id=?))
        AND NOT EXISTS (SELECT 1 FROM blocked_hashtags bh WHERE bh.user_id=ps.user_id AND bh.tag=?)`)
        .all(actorId, actorId, tag, actorId, actorId, tag) as DatabaseDomainOutput<K>
    }
    case 'push.signupDelivery': {
      const { administratorEmails } = input as DatabaseDomainInput<'push.signupDelivery'>
      if (!administratorEmails.length) return [] as DatabaseDomainOutput<K>
      const placeholders = administratorEmails.map(() => '?').join(',')
      const subscriptions = database.query(`SELECT ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps
        JOIN users u ON u.id=ps.user_id WHERE lower(u.email) IN (${placeholders}) AND ps.notify_signups=1
          AND u.deleted_at IS NULL AND u.suspended_at IS NULL`).all(...administratorEmails)
      return subscriptions as DatabaseDomainOutput<K>
    }
    case 'profiles.ogData': {
      const resolved = resolveHandle(database, (input as DatabaseDomainInput<'profiles.ogData'>).handle)
      if (!resolved) return null as DatabaseDomainOutput<K>
      if (resolved.alias) return { canonicalHandle: resolved.handle } as DatabaseDomainOutput<K>
      const profile = database.query(
        `SELECT u.handle,u.bio,
        (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) notes,
        (SELECT count(*) FROM follows f WHERE f.follower_id=u.id) following,
        (SELECT count(*) FROM hashtag_follows hf WHERE hf.user_id=u.id) followingTags,
        (SELECT count(*) FROM follows f WHERE f.following_id=u.id) followers
        FROM users u WHERE u.id=? AND u.deleted_at IS NULL`,
      ).get(resolved.id) as { handle: string; bio: string; notes: number; following: number; followingTags: number;
        followers: number } | null
      return (profile ? { profile } : null) as DatabaseDomainOutput<K>
    }
    case 'feeds.aboutTopPosts': {
      return recapPosts(database, -1) as DatabaseDomainOutput<K>
    }
    case 'feeds.latestPage': {
      const { viewerId, page, pageSize } = input as DatabaseDomainInput<'feeds.latestPage'>
      const parameters = [viewerId, viewerId, viewerId, viewerId, viewerId]
      const snapshot = feedSnapshotPage<PostView>(database, 'latest', viewerId, page, () =>
        database.query(
          `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
          WHERE p.deleted_at IS NULL AND u.is_bot=0 AND (? < 0 OR NOT EXISTS
          (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
            OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
          AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
            WHERE ph.post_id=p.id AND bh.user_id=?)) ORDER BY p.id DESC`,
        ).all(...parameters) as PostView[], pageSize, cacheDb)
      return { posts: enrichPosts(database, snapshot.items, viewerId), page: snapshot.page,
        totalItems: snapshot.totalItems, totalPages: snapshot.totalPages,
        forYouCount: viewerId >= 0 ? unreadForYouCount(viewerId, database) : 0,
        forYouUnread: viewerId >= 0 && hasUnreadForYou(viewerId, database),
        toMeUnread: viewerId >= 0 && hasUnreadToMe(viewerId, database) } as DatabaseDomainOutput<K>
    }
    case 'feeds.hotPage': {
      const { viewerId, page, pageSize } = input as DatabaseDomainInput<'feeds.hotPage'>
      const snapshot = feedSnapshotPage<HotPost>(database, `hot:${hotRankingVersion}`, viewerId, page,
        () => getHotPosts(database, 1_000_000, null, new Date(), viewerId, false, 2), pageSize, cacheDb)
      return { posts: enrichPosts(database, snapshot.items, viewerId), page: snapshot.page,
        totalItems: snapshot.totalItems, totalPages: snapshot.totalPages,
        forYouCount: viewerId >= 0 ? unreadForYouCount(viewerId, database) : 0,
        forYouUnread: viewerId >= 0 && hasUnreadForYou(viewerId, database),
        toMeUnread: viewerId >= 0 && hasUnreadToMe(viewerId, database) } as DatabaseDomainOutput<K>
    }
    case 'feeds.personalizedPage': {
      const { user, page, pageSize, toMe, path, markRead = true } = input as DatabaseDomainInput<
        'feeds.personalizedPage'
      >
      const result = loadPersonalizedFeed(database, user, page, pageSize, toMe, path, markRead)
      if (markRead && result.timeline.some(row => row.unread)) {
        cacheDb.query(`DELETE FROM materialized_feed_pages_v2 WHERE viewer_id=?
          AND kind IN ('latest','hot','for-you','to-me')`).run(user.id)
      }
      return result as DatabaseDomainOutput<K>
    }
    case 'feeds.bannerState': {
      const { userId, userAgent } = input as DatabaseDomainInput<'feeds.bannerState'>
      const exists = (sql: string, ...parameters: Array<string | number>) => !!database.query(sql).get(...parameters)
      const result = {
        inviteHandled: exists('SELECT 1 FROM invite_banner_dismissals WHERE user_id=? LIMIT 1', userId),
        notificationsEnabled: !!userAgent
          && exists(
            'SELECT 1 FROM notification_user_agents WHERE user_id=? AND user_agent=? AND status=\'enabled\' LIMIT 1',
            userId,
            userAgent,
          ),
        improvementDismissed: !!userAgent
          && exists('SELECT 1 FROM notification_improvement_user_agents WHERE user_id=? AND user_agent=? LIMIT 1',
            userId, userAgent),
        notificationsHandled: !!userAgent
          && exists('SELECT 1 FROM notification_user_agents WHERE user_id=? AND user_agent=? LIMIT 1', userId,
            userAgent),
        appearanceHandled: !!userAgent
          && exists('SELECT 1 FROM appearance_user_agents WHERE user_id=? AND user_agent=? LIMIT 1', userId, userAgent),
        donationDismissed: exists('SELECT 1 FROM donation_banner_dismissals WHERE user_id=? LIMIT 1', userId),
      }
      return result as DatabaseDomainOutput<K>
    }
    case 'feeds.recordBanner': {
      const { userId, userAgent, action } = input as DatabaseDomainInput<'feeds.recordBanner'>
      if (action === 'notifications-dismissed' && userAgent) {
        database.query(
          `INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'dismissed')
        ON CONFLICT(user_id,user_agent) DO UPDATE SET status='dismissed',updated_at=CURRENT_TIMESTAMP`,
        ).run(userId, userAgent)
      }
      else if (action === 'notification-improvements-dismissed' && userAgent) {
        database.query(
          `INSERT INTO notification_improvement_user_agents(user_id,user_agent) VALUES(?,?)
        ON CONFLICT(user_id,user_agent) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`,
        ).run(userId, userAgent)
      }
      else if ((action === 'appearance-dismissed' || action === 'appearance-seen') && userAgent) {
        const status = action === 'appearance-seen' ? 'seen' : 'dismissed'
        database.query(`INSERT INTO appearance_user_agents(user_id,user_agent,status) VALUES(?,?,?)
          ON CONFLICT(user_id,user_agent) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP`)
          .run(userId, userAgent, status)
      }
      else if (action === 'invite-dismissed') {
        database.query(
          `INSERT INTO invite_banner_dismissals(user_id) VALUES(?)
        ON CONFLICT(user_id) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`,
        ).run(userId)
      }
      else if (action === 'donation-dismissed') {
        database.query(
          `INSERT INTO donation_banner_dismissals(user_id) VALUES(?)
        ON CONFLICT(user_id) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`,
        ).run(userId)
      }
      return null as DatabaseDomainOutput<K>
    }
    case 'feeds.markRead': {
      const { userId, toMe } = input as DatabaseDomainInput<'feeds.markRead'>
      markAllForYouRead(userId, toMe, database)
      return null as DatabaseDomainOutput<K>
    }
    case 'cache.materializedFeedGet': {
      const { kind, viewerId, variant } = input as DatabaseDomainInput<'cache.materializedFeedGet'>
      const generation = (database.query('SELECT generation FROM feed_snapshot_generation WHERE id=1').get() as {
        generation: number
      }).generation
      const cached = cacheDb.query(`SELECT html FROM materialized_feed_pages_v2
        WHERE kind=? AND viewer_id=? AND variant=? AND generation=?`).get(kind, viewerId, variant, generation) as {
        html: string
      } | null
      return { html: cached?.html ?? null, generation } as DatabaseDomainOutput<K>
    }
    case 'cache.materializedFeedPut': {
      const { kind, viewerId, variant, html, generation } = input as DatabaseDomainInput<'cache.materializedFeedPut'>
      const currentGeneration = (database.query('SELECT generation FROM feed_snapshot_generation WHERE id=1').get() as {
        generation: number
      }).generation
      if (generation !== currentGeneration) return null as DatabaseDomainOutput<K>
      if (viewerId >= 0) {
        const cachedForYouCount = Number(html.match(
          /href="\/for-you"[^>]*>for you<span class="to-me-count">(\d+)<\/span>/,
        )?.[1] || 0)
        if (cachedForYouCount !== unreadForYouCount(viewerId, database)) return null as DatabaseDomainOutput<K>
      }
      cacheDb.transaction(() => {
        cacheDb.query('DELETE FROM materialized_feed_pages_v2 WHERE kind=? AND viewer_id=? AND generation!=?')
          .run(kind, viewerId, generation)
        cacheDb.query(`INSERT OR REPLACE INTO materialized_feed_pages_v2(kind,viewer_id,variant,generation,html)
          VALUES(?,?,?,?,?)`).run(kind, viewerId, variant, generation, html)
        cacheDb.query(`DELETE FROM materialized_feed_pages_v2 WHERE rowid IN (
          SELECT rowid FROM materialized_feed_pages_v2 ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET ?
        )`).run(MAX_MATERIALIZED_PAGES)
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'cache.recentFeedVisitorPut': {
      const { userId, requestUrl, cookie, pageSize, density } = input as DatabaseDomainInput<
        'cache.recentFeedVisitorPut'
      >
      cacheDb.transaction(() => {
        cacheDb.query(`INSERT INTO recent_feed_visitors(user_id,request_url,cookie,page_size,density,last_visited_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET request_url=excluded.request_url,
          cookie=excluded.cookie,page_size=excluded.page_size,density=excluded.density,
          last_visited_at=excluded.last_visited_at`).run(userId, requestUrl, cookie, pageSize, density, Date.now())
        cacheDb.query(`DELETE FROM recent_feed_visitors WHERE user_id IN (
          SELECT user_id FROM recent_feed_visitors ORDER BY last_visited_at DESC,user_id DESC LIMIT -1 OFFSET 30
        )`).run()
      })()
      return null as DatabaseDomainOutput<K>
    }
    case 'cache.recentFeedVisitors': {
      const rows = cacheDb.query(`SELECT user_id,request_url,cookie,page_size,density FROM recent_feed_visitors
        ORDER BY last_visited_at ASC,user_id ASC LIMIT 30`).all() as Array<
        { user_id: number; request_url: string; cookie: string; page_size: PageSizeChoice; density: DensityChoice }
      >
      const result = rows.flatMap(row => {
        const user = database.query(`SELECT id,handle,email,bio,suspended_at,email_verified_at,handle_chosen_at,
          show_link_previews,timezone FROM users WHERE id=? AND deleted_at IS NULL AND suspended_at IS NULL`)
          .get(row.user_id) as User | null
        return user
          ? [{ user, requestUrl: row.request_url, cookie: row.cookie, pageSize: row.page_size, density: row.density }]
          : []
      })
      return result as DatabaseDomainOutput<K>
    }
    case 'search.results': {
      const { query, viewerId, page, pageSize, tab } = input as DatabaseDomainInput<'search.results'>
      const notes = searchPosts(database, query, viewerId, tab === 'notes' ? page : 1, pageSize)
      const tags = searchTags(database, query, viewerId, tab === 'tags' ? page : 1)
      const people = searchPeople(database, query, viewerId, tab === 'people' ? page : 1)
      const selected = tab === 'notes' ? notes : tab === 'tags' ? tags : people
      const result = { totals: { notes: notes.total, tags: tags.total, people: people.total },
        posts: tab === 'notes' ? enrichPosts(database, notes.rows, viewerId) : [],
        tags: tab === 'tags' ? attachTagStats(database, tags.rows, viewerId) : [],
        people: tab === 'people' ? attachPeopleStats(database, people.rows, viewerId) : [],
        highlights: searchTerms(query),
        totalPages: Math.max(1, Math.ceil(selected.total / (tab === 'notes' ? pageSize : PAGE_SIZE))) }
      return result as DatabaseDomainOutput<K>
    }
    case 'explore.page': {
      const { viewerId, peopleIds, tagsPage, peoplePage } = input as DatabaseDomainInput<'explore.page'>
      const savedIds = peopleIds?.filter((id, index, ids) =>
        Number.isInteger(id) && id > 0
        && ids.indexOf(id) === index
      ).slice(0, 8)
      const people = savedIds?.length
        ? (database.query(
          `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
            EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following
            FROM users u WHERE u.id IN (${savedIds.map(() => '?').join(',')}) AND u.deleted_at IS NULL
            AND u.handle_chosen_at IS NOT NULL
            AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
              (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`,
        ).all(viewerId, ...savedIds, viewerId, viewerId, viewerId) as import('./types').PersonView[])
          .sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id))
        : suggestedPeople(database, viewerId, 8, undefined, (peoplePage - 1) * 8)
      const stats = visibleUserProfileStats(database, people.map(person => person.id), viewerId)
      const profileStats = Object.fromEntries(stats) as import('./types').ExploreData['profileStats']
      const result = {
        people: attachPeopleStats(database, people, viewerId),
        tags: attachTagStats(database,
          trendingTags(database, viewerId, TAG_PAGE_SIZE, undefined, (tagsPage - 1) * TAG_PAGE_SIZE), viewerId),
        peopleTotal: suggestedPeopleCount(database, viewerId),
        tagsTotal: trendingTagCount(database, viewerId),
        profileStats,
      }
      return result as DatabaseDomainOutput<K>
    }
    case 'tags.count': {
      const { tag } = input as DatabaseDomainInput<'tags.count'>
      return (database.query(`SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
        WHERE ph.tag=? AND p.deleted_at IS NULL`).get(tag) as { count: number }).count as DatabaseDomainOutput<K>
    }
    case 'tags.page': {
      const { tag, viewerId, page, pageSize, tab } = input as DatabaseDomainInput<'tags.page'>
      const following = viewerId >= 0 && !!database.query(
        'SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?',
      ).get(viewerId, tag)
      const blocked = viewerId >= 0 && !!database.query(
        'SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?',
      ).get(viewerId, tag)
      const rawPosts = blocked || tab === 'followers' ? [] : database.query(
        `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id JOIN post_hashtags ph ON ph.post_id=p.id
        WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      ).all(tag, viewerId, viewerId, viewerId, pageSize, (page - 1) * pageSize) as PostView[]
      const total = blocked ? 0 : (database.query(
        `SELECT count(*) AS count FROM post_hashtags ph JOIN posts p ON p.id=ph.post_id
        WHERE ph.tag=? AND p.deleted_at IS NULL AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))`,
      ).get(tag, viewerId, viewerId, viewerId) as { count: number }).count
      const followerTotal = (database.query(
        `SELECT count(*) count FROM hashtag_follows hf JOIN users u ON u.id=hf.user_id
        WHERE hf.tag=? AND u.deleted_at IS NULL AND u.suspended_at IS NULL
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`,
      ).get(tag, viewerId, viewerId, viewerId) as { count: number }).count
      const people = tab === 'followers'
        ? database.query(
          `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
          EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) viewerFollowing
        FROM hashtag_follows hf JOIN users u ON u.id=hf.user_id
        WHERE hf.tag=? AND u.deleted_at IS NULL AND u.suspended_at IS NULL
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))
        ORDER BY u.handle LIMIT ? OFFSET ?`,
        ).all(viewerId, tag, viewerId, viewerId, viewerId, CONNECTION_PAGE_SIZE,
          (page - 1) * CONNECTION_PAGE_SIZE) as import('./types').PersonView[]
        : []
      const result = { following, blocked, posts: enrichPosts(database, rawPosts, viewerId), total, followerTotal,
        people: attachPeopleStats(database, people, viewerId) }
      return result as DatabaseDomainOutput<K>
    }
    case 'embeds.load': {
      const request = input as DatabaseDomainInput<'embeds.load'>
      const latest = (where = '', parameters: Array<string | number> = []) =>
        enrichPosts(database, database.query(`SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
          ${where ? `WHERE ${where} AND` : 'WHERE'} p.deleted_at IS NULL AND u.deleted_at IS NULL
          ORDER BY p.id DESC LIMIT ?`).all(...parameters, 5) as PostView[], -1)
      let result: import('./types').EmbedData | null
      if (request.kind === 'latest') result = { posts: latest(), title: 'latest', href: '/latest' }
      else if (request.kind === 'hot') {
        result = { posts: enrichPosts(database, getHotPosts(database, 5, null, new Date(), -1, true), -1), title: 'hot',
          href: '/hot' }
      }
      else if (request.kind === 'tag') {
        result = { posts: latest(
          'EXISTS(SELECT 1 FROM post_hashtags ph WHERE ph.post_id=p.id AND ph.tag=?)',
          [request.tag],
        ), title: `#${request.tag}`, href: `/tag/${encodeURIComponent(request.tag)}` }
      }
      else if (request.kind === 'user') {
        const resolved = resolveHandle(database, request.handle)
        result = resolved
          ? { posts: latest('p.user_id=?', [resolved.id]), title: `@${resolved.handle}`, href: `/u/${resolved.handle}`,
            canonicalHandle: resolved.alias ? resolved.handle : undefined }
          : null
      }
      else if (request.kind === 'post') {
        const row = Number.isInteger(request.id) && request.id > 0
          ? database.query(
            `SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id
          WHERE p.id=? AND p.deleted_at IS NULL AND u.deleted_at IS NULL`,
          ).get(request.id) as PostView | null
          : null
        result = row
          ? { posts: enrichPosts(database, [row], -1), title: `post ${request.id}`, href: `/post/${request.id}` }
          : null
      }
      else result = null
      return result as DatabaseDomainOutput<K>
    }
    case 'reports.createIllegalActivity': {
      const report = input as DatabaseDomainInput<'reports.createIllegalActivity'>
      if (!database.query('SELECT 1 FROM posts WHERE id=?').get(report.postId)) {
        return false as DatabaseDomainOutput<K>
      }
      database.query(`INSERT INTO illegal_activity_reports(post_id,content_url,details,reporter_email,reference,
        category,reporter_name,good_faith) VALUES(?,?,?,?,?,?,?,1)`).run(report.postId, report.contentUrl,
        report.details, report.reporterEmail, report.reference, report.category, report.reporterName)
      return true as DatabaseDomainOutput<K>
    }
    case 'interactions.toggleFollow': {
      const { userId, handle } = input as DatabaseDomainInput<'interactions.toggleFollow'>
      const target = resolveHandle(database, handle)
      const blocked = target && database.query(`SELECT 1 FROM blocks WHERE
        (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)`).get(userId, target.id, target.id, userId)
      if (!target || target.id === userId || blocked) return null as DatabaseDomainOutput<K>
      const exists = !!database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?')
        .get(userId, target.id)
      if (exists) database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(userId, target.id)
      else {database.query(
          'INSERT OR IGNORE INTO follows(follower_id,following_id,created_at) VALUES(?,?,CURRENT_TIMESTAMP)',
        )
          .run(userId, target.id)}
      return { targetId: target.id, targetHandle: target.handle, followed: !exists } as DatabaseDomainOutput<K>
    }
    case 'interactions.toggleBlock': {
      const { userId, handle } = input as DatabaseDomainInput<'interactions.toggleBlock'>
      const target = resolveHandle(database, handle)
      if (!target || target.id === userId) return null as DatabaseDomainOutput<K>
      const exists = !!database.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(userId, target.id)
      database.transaction(() => {
        if (exists) database.query('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(userId, target.id)
        else {
          database.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(?,?)').run(userId, target.id)
          database.query('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(userId, target.id)
        }
      })()
      return { targetHandle: target.handle, blocked: !exists } as DatabaseDomainOutput<K>
    }
    case 'interactions.reportPost': {
      const { userId, postId, reason } = input as DatabaseDomainInput<'interactions.reportPost'>
      const raw = Number.isInteger(postId)
        ? database.query(`SELECT p.*,u.handle,u.bio FROM posts p
        JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.deleted_at IS NULL`).get(postId) as PostView | null
        : null
      if (!raw) return { status: 'not_found' } as DatabaseDomainOutput<K>
      if (raw.user_id === userId) return { status: 'own_post' } as DatabaseDomainOutput<K>
      const blocked = database.query(`SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?)
        OR (blocker_id=? AND blocked_id=?)`).get(userId, raw.user_id, raw.user_id, userId)
      if (blocked) return { status: 'not_found' } as DatabaseDomainOutput<K>
      const post = enrichPosts(database, [raw], userId)[0]
      if (!reason) return { status: 'ready', post } as DatabaseDomainOutput<K>
      database.query(`INSERT INTO reports(reporter_id,post_id,reason) VALUES(?,?,?)
        ON CONFLICT(reporter_id,post_id) DO UPDATE SET reason=excluded.reason,created_at=CURRENT_TIMESTAMP`)
        .run(userId, postId, reason)
      return { status: 'reported', post } as DatabaseDomainOutput<K>
    }
    case 'interactions.toggleTagFollow': {
      const { userId, tag } = input as DatabaseDomainInput<'interactions.toggleTagFollow'>
      const exists = !!database.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=?').get(userId, tag)
      if (exists) database.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(userId, tag)
      else {database.query(
          'INSERT OR IGNORE INTO hashtag_follows(user_id,tag,created_at) VALUES(?,?,CURRENT_TIMESTAMP)',
        )
          .run(userId, tag)}
      return { followed: !exists } as DatabaseDomainOutput<K>
    }
    case 'interactions.toggleTagBlock': {
      const { userId, tag } = input as DatabaseDomainInput<'interactions.toggleTagBlock'>
      const exists = !!database.query('SELECT 1 FROM blocked_hashtags WHERE user_id=? AND tag=?').get(userId, tag)
      database.transaction(() => {
        if (exists) database.query('DELETE FROM blocked_hashtags WHERE user_id=? AND tag=?').run(userId, tag)
        else {
          database.query('INSERT INTO blocked_hashtags(user_id,tag) VALUES(?,?)').run(userId, tag)
          database.query('DELETE FROM hashtag_follows WHERE user_id=? AND tag=?').run(userId, tag)
        }
      })()
      return { blocked: !exists } as DatabaseDomainOutput<K>
    }
  }
  throw new Error(`Unsupported database domain operation: ${operation}`)
}
