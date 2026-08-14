import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { Database } from 'bun:sqlite'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'

setDefaultTimeout(30_000)

type CapturedEmail = { to: string; subject: string; text: string; html: string }

const projectRoot = resolve(dirname(import.meta.path), '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'textlog-routes-'))
const databasePath = join(temporaryDirectory, 'route-tests.sqlite')
const emailCapturePath = join(temporaryDirectory, 'emails.jsonl')
let origin = ''
let server: ReturnType<typeof Bun.spawn>
let database: Database

async function availablePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate a test port'))
      socket.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (server.exitCode !== null) break
    try {
      const response = await fetch(`${origin}/health`)
      if (response.ok) return
    }
    catch {}
    await Bun.sleep(50)
  }
  const stderr = server.stderr instanceof ReadableStream ? await new Response(server.stderr).text() : ''
  throw new Error(`Test server did not become ready. ${stderr}`)
}

function capturedEmails() {
  if (!existsSync(emailCapturePath)) return []
  return readFileSync(emailCapturePath, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as CapturedEmail)
}

function linkToken(email: CapturedEmail) {
  const link = email.text.match(/https?:\/\/[^\s]+/)?.[0]
  if (!link) throw new Error(`No link found in captured email: ${email.subject}`)
  const value = new URL(link).searchParams.get('token')
  if (!value) throw new Error(`No token found in captured email: ${email.subject}`)
  return value
}

function entryCode(email: CapturedEmail) {
  const value = email.text.match(/six-digit code: (\d{6})/)?.[1]
  if (!value) throw new Error(`No entry code found in captured email: ${email.subject}`)
  return value
}

async function passwordLoginNonce() {
  const response = await request('/enter/password')
  const value = (await response.text()).match(/name="nonce" value="([^"]+)"/)?.[1]
  if (!value) throw new Error('Password login form did not contain a nonce')
  return value
}

function sessionCookie(response: Response) {
  const cookie = response.headers.get('set-cookie')?.match(/(?:^|,\s*)(textlog=[^;]+)/)?.[1]
  if (!cookie) throw new Error('Response did not set a session cookie')
  return cookie
}

async function request(path: string, options: {
  method?: 'GET' | 'POST' | 'DELETE'
  cookie?: string
  token?: string
  form?: Record<string, string>
  json?: unknown
  userAgent?: string
  ip?: string
} = {}) {
  const method = options.method || 'GET'
  const headers = new Headers()
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  if (options.userAgent) headers.set('user-agent', options.userAgent)
  if (options.ip) headers.set('x-forwarded-for', options.ip)
  if (method !== 'GET') headers.set('origin', origin)
  if (options.json !== undefined) headers.set('content-type', 'application/json')
  return await fetch(`${origin}${path}`, {
    method,
    headers,
    body: options.json !== undefined
      ? JSON.stringify(options.json)
      : options.form
      ? new URLSearchParams(options.form)
      : undefined,
    redirect: 'manual',
  })
}

async function signup(handle: string, email: string, _password: string, ip?: string) {
  const response = await request('/enter', { method: 'POST', form: { email }, ip })
  expect(response.status).toBe(200)
  const emailMessage = capturedEmails().filter(message => message.to === email && message.subject.includes('textlog'))
    .at(-1)
  expect(emailMessage).toBeDefined()
  const magic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(emailMessage!))}`)
  expect(magic.status).toBe(303)
  const cookie = sessionCookie(magic)
  if (magic.headers.get('location')?.startsWith('/choose-handle')) {
    const chooseLocation = magic.headers.get('location')!
    const next = new URL(chooseLocation, origin).searchParams.get('next') || '/'
    const chosen = await request('/choose-handle', { method: 'POST', cookie, form: { handle, next } })
    expect(chosen.status).toBe(303)
    expect(chosen.headers.get('location')).toBe('/explore?welcome=1')
  }
  return cookie
}

beforeAll(async () => {
  const port = await availablePort()
  origin = `http://127.0.0.1:${port}`
  server = Bun.spawn([process.execPath, '--no-env-file', 'src/server.tsx'], {
    cwd: projectRoot,
    env: {
      NODE_ENV: 'test',
      APP_URL: origin,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: databasePath,
      DATABASE_BACKUP_DIR: join(temporaryDirectory, 'backups'),
      MODERATION_DISABLED: 'true',
      TRUST_PROXY: 'true',
      EMAIL_CAPTURE_PATH: emailCapturePath,
      LOG_COLOR: 'false',
      PATH: process.env.PATH || '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await waitForServer()
  database = new Database(databasePath)
  database.run('PRAGMA busy_timeout=5000')
})

afterAll(async () => {
  database?.close()
  if (server && server.exitCode === null) server.kill()
  if (server) await server.exited
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

test('stats are public without exposing admin operations', async () => {
  const response = await request('/stats')
  expect(response.status).toBe(200)
  expect(response.headers.get('x-robots-tag')).toBeNull()
  expect(response.headers.get('link')).toContain(`${origin}/stats`)

  const html = await response.text()
  expect(html).toContain('<h1>stats</h1>')
  expect(html).not.toContain('<p class="eyebrow">textlog</p>')
  expect(html).toContain('aria-label="Application statistics"')
  expect(html).toContain('<span>users</span>')
  expect(html).not.toContain('<span>suspended</span>')
  expect(html).not.toContain('<span>users online · 30m</span>')
  expect(html).not.toContain('admin dashboard')
  expect(html).not.toContain('illegal activity reports')
  expect(html).not.toContain('recent admin actions')
})

test('notification banner is hidden from logged-out visitors', async () => {
  for (const path of ['/', '/hot', '/latest']) {
    const response = await request(path)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('class="notification-banner"')
  }
})

test('email code signs up and invalidates its matching magic link', async () => {
  const email = 'code-signup@example.com'
  const sent = await request('/enter', { method: 'POST', form: { email, next: '/about' } })
  expect(sent.status).toBe(200)
  const sentHtml = await sent.text()
  expect(sentHtml).toContain('action="/enter/code"')
  expect(sentHtml).toContain('or enter the six-digit code')

  const message = capturedEmails().filter(item => item.to === email).at(-1)
  expect(message).toBeDefined()
  const value = linkToken(message!)
  const entered = await request('/enter/code', { method: 'POST', form: { email, code: entryCode(message!) } })
  expect(entered.status).toBe(303)
  expect(entered.headers.get('location')).toBe('/choose-handle?next=%2Fabout')
  expect(sessionCookie(entered)).toStartWith('textlog=')

  const reusedLink = await request(`/enter/magic?token=${encodeURIComponent(value)}`)
  expect(reusedLink.status).toBe(400)
  expect(await reusedLink.text()).toContain('magic link is invalid or has expired')
})

test('magic link requested by handle is sent to the account email', async () => {
  database.query(`INSERT INTO users(handle,email,password,email_verified_at,handle_chosen_at)
    VALUES(?,?,'!',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run('handlelogin', 'handle-login@example.com')

  const sent = await request('/enter', { method: 'POST', form: { identifier: 'HANDLELOGIN' } })
  expect(sent.status).toBe(200)
  const sentHtml = await sent.text()
  expect(sentHtml).toContain('Magic link and code sent to the email of <strong>handlelogin</strong>')
  expect(sentHtml).not.toContain('handle-login@example.com')
  const message = capturedEmails().filter(item => item.to === 'handle-login@example.com').at(-1)
  expect(message).toBeDefined()

  const entered = await request('/enter/code', {
    method: 'POST',
    form: { identifier: 'HANDLELOGIN', code: entryCode(message!) },
  })
  expect(entered.status).toBe(303)
})

test('accounts sharing an email can be created, switched, and selected by magic-link login', async () => {
  const email = 'personas@example.com'
  const primaryCookie = await signup('persona_primary', email, 'unused', 'personas-signup')
  const primary = database.query('SELECT id,account_group_id FROM users WHERE handle=?').get('persona_primary') as {
    id: number
    account_group_id: number
  }

  const edit = await request('/account/edit', { cookie: primaryCookie })
  expect(await edit.text()).toContain(
    'class="profile-edit-link profile-switch-link" href="/account/accounts">switch</a>',
  )
  const initialList = await request('/account/accounts', { cookie: primaryCookie })
  const initialHtml = await initialList.text()
  expect(initialHtml).toContain('@persona_primary')
  expect(initialHtml).toContain('<span>primary</span>')
  expect(initialHtml).toContain('<span>current</span>')
  expect(initialHtml).toContain('action="/account/accounts/new"')

  const created = await request('/account/accounts/new', { method: 'POST', cookie: primaryCookie })
  expect(created.status).toBe(303)
  expect(created.headers.get('location')).toBe('/choose-handle?next=%2Faccount%2Faccounts')
  const chosen = await request('/choose-handle', {
    method: 'POST',
    cookie: primaryCookie,
    form: { handle: 'persona_bot', next: '/account/accounts' },
  })
  expect(chosen.status).toBe(303)
  expect(chosen.headers.get('location')).toBe('/account/accounts')
  const bot = database.query('SELECT id,email,account_group_id FROM users WHERE handle=?').get('persona_bot') as {
    id: number
    email: string
    account_group_id: number
  }
  expect(bot.email).toBe(email)
  expect(bot.account_group_id).toBe(primary.account_group_id)
  expect(
    database.query('SELECT user_id FROM account_creation_events WHERE account_group_id=?').all(
      primary.account_group_id,
    ),
  )
    .toEqual([{ user_id: bot.id }])
  expect(database.query('SELECT primary_user_id,selected_user_id FROM account_groups WHERE id=?')
    .get(primary.account_group_id)).toEqual({ primary_user_id: primary.id, selected_user_id: bot.id })

  const selectedPrimary = await request('/account/accounts/select', {
    method: 'POST',
    cookie: primaryCookie,
    form: { accountId: String(primary.id) },
  })
  expect(selectedPrimary.status).toBe(303)
  expect(await (await request('/account/edit', { cookie: primaryCookie })).text()).toContain('>@persona_primary</a>')

  const handleLogin = await request('/enter', {
    method: 'POST',
    form: { identifier: 'persona_bot' },
    ip: 'personas-handle-login',
  })
  expect(handleLogin.status).toBe(200)
  const handleEmail = capturedEmails().filter(message => message.to === email).at(-1)!
  const enteredBot = await request(`/enter/magic?token=${encodeURIComponent(linkToken(handleEmail))}`)
  expect(enteredBot.status).toBe(303)
  const botCookie = sessionCookie(enteredBot)
  expect(await (await request('/account/edit', { cookie: botCookie })).text()).toContain('>@persona_bot</a>')
  expect(database.query('SELECT selected_user_id FROM account_groups WHERE id=?').get(primary.account_group_id))
    .toEqual({ selected_user_id: bot.id })

  const sharedEndpoint = 'https://push.example/personas-browser'
  const botPush = await request('/account/push-subscription', {
    method: 'POST',
    cookie: botCookie,
    userAgent: 'personas-browser',
    json: { endpoint: sharedEndpoint, keys: { p256dh: 'shared-key', auth: 'shared-auth' },
      preferences: { latest: false, replies: false, mentions: false, follows: false, ownPosts: false } },
  })
  const primaryPush = await request('/account/push-subscription', {
    method: 'POST',
    cookie: primaryCookie,
    userAgent: 'personas-browser',
    json: { endpoint: sharedEndpoint, keys: { p256dh: 'rotated-key', auth: 'rotated-auth' },
      preferences: { latest: true, replies: true, mentions: true, follows: true, ownPosts: true } },
  })
  expect(botPush.status).toBe(200)
  expect(primaryPush.status).toBe(200)
  expect(database.query(`SELECT user_id,p256dh,notify_latest,notify_mentions FROM push_subscriptions
    WHERE endpoint=? ORDER BY user_id`).all(sharedEndpoint)).toEqual([
    { user_id: primary.id, p256dh: 'rotated-key', notify_latest: 1, notify_mentions: 1 },
    { user_id: bot.id, p256dh: 'rotated-key', notify_latest: 0, notify_mentions: 0 },
  ])
  const disabledBotPush = await request('/account/push-subscription', {
    method: 'DELETE',
    cookie: botCookie,
    userAgent: 'personas-browser',
    json: { endpoint: sharedEndpoint },
  })
  expect(await disabledBotPush.json()).toEqual({ removed: true, active: true })
  expect(database.query('SELECT user_id FROM push_subscriptions WHERE endpoint=?').all(sharedEndpoint))
    .toEqual([{ user_id: primary.id }])
  expect(await (await request('/account/push-subscription?endpoint=' + encodeURIComponent(sharedEndpoint), {
    cookie: botCookie,
  })).json()).toMatchObject({ enabled: false })
  expect(await (await request('/account/push-subscription?endpoint=' + encodeURIComponent(sharedEndpoint), {
    cookie: primaryCookie,
  })).json()).toMatchObject({ enabled: true })

  const beforeEmailLogin = capturedEmails().length
  const emailLogin = await request('/enter', {
    method: 'POST',
    form: { identifier: email },
    ip: 'personas-email-login',
  })
  expect(emailLogin.status).toBe(200)
  expect(capturedEmails()).toHaveLength(beforeEmailLogin + 1)
  const emailMessage = capturedEmails().at(-1)!
  expect(emailMessage.to).toBe(email)
  const enteredSelected = await request(`/enter/magic?token=${encodeURIComponent(linkToken(emailMessage))}`)
  expect(enteredSelected.status).toBe(303)
  const selectedCookie = sessionCookie(enteredSelected)
  expect(await (await request('/account/edit', { cookie: selectedCookie })).text())
    .toContain('>@persona_bot</a>')

  const secondCreated = await request('/account/accounts/new', { method: 'POST', cookie: selectedCookie })
  expect(secondCreated.status).toBe(303)
  expect(database.query(`SELECT account_group_id,user_id,created_at,
      created_at>datetime('now','-1 month') recent FROM account_creation_events WHERE account_group_id=? ORDER BY id`)
    .all(primary.account_group_id)).toEqual([
      expect.objectContaining({ recent: 1 }),
    ])
  const secondChosen = await request('/choose-handle', {
    method: 'POST',
    cookie: selectedCookie,
    form: { handle: 'persona_second', next: '/account/accounts' },
  })
  expect(secondChosen.status).toBe(303)
  const thirdCreated = await request('/account/accounts/new', { method: 'POST', cookie: selectedCookie })
  expect(thirdCreated.status).toBe(303)
  expect(thirdCreated.headers.get('location')).toBe('/choose-handle?next=%2Faccount%2Faccounts')
  const limited = await request('/choose-handle', {
    method: 'POST',
    cookie: selectedCookie,
    form: { handle: 'persona_third', next: '/account/accounts' },
  })
  expect(limited.status).toBe(429)
  const limitedHtml = await limited.text()
  expect(limitedHtml).toContain('You can create up to two new accounts per month.')
  expect(limitedHtml).toContain('Choose a handle from one of your deleted accounts to reclaim it')
  expect(database.query('SELECT COUNT(*) count FROM account_creation_events WHERE account_group_id=?')
    .get(primary.account_group_id)).toEqual({ count: 2 })
})

test('handle choice accepts invalid submissions and reports their character count', async () => {
  const email = 'invalid-handle@example.com'
  await request('/enter', { method: 'POST', form: { email } })
  const message = capturedEmails().filter(item => item.to === email).at(-1)
  expect(message).toBeDefined()
  const magic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(message!))}`)
  const cookie = sessionCookie(magic)

  const response = await request('/choose-handle', {
    method: 'POST',
    cookie,
    form: { handle: 'bad handle!' },
  })
  expect(response.status).toBe(400)
  const html = await response.text()
  expect(html).toContain('You typed 11 characters.')
  expect(html).toContain('value="bad handle!"')
})

test('account security creates one-time, revocable API keys', async () => {
  const cookie = await signup('keyuser', 'keyuser@example.com', 'unused')
  const form = await request('/account/api-keys/new', { cookie })
  expect(form.status).toBe(200)
  expect(await form.text()).toContain('action="/account/api-keys"')
  const created = await request('/account/api-keys', {
    method: 'POST',
    cookie,
    form: { name: 'test integration', lifetime: 'never' },
  })
  expect(created.status).toBe(200)
  expect(created.headers.get('cache-control')).toContain('no-store')
  const html = await created.text()
  const value = html.match(/tlk_[A-Za-z0-9_-]{43}/)?.[0]
  expect(value).toBeDefined()
  expect(database.query('SELECT token_hash FROM api_keys WHERE name=?').get('test integration'))
    .not.toMatchObject({ token_hash: value })

  const authenticated = await request('/api/v1/me', { token: value })
  expect(authenticated.status).toBe(200)
  expect(await authenticated.json()).toMatchObject({ data: { handle: 'keyuser' } })

  const key = database.query('SELECT id,last_used_at FROM api_keys WHERE name=?').get('test integration') as {
    id: number
    last_used_at: number | null
  }
  expect(key.last_used_at).not.toBeNull()
  const revoked = await request('/account/api-keys/revoke', {
    method: 'POST',
    cookie,
    form: { id: String(key.id) },
  })
  expect(revoked.status).toBe(303)
  expect((await request('/api/v1/me', { token: value })).status).toBe(401)
})

test('consequential account, content, reporting, and admin flows work over HTTP', async () => {
  let aliceCookie = await signup('alice', 'alice@example.com', 'unused')
  const alice = database.query('SELECT id,email_verified_at FROM users WHERE handle=?')
    .get('alice') as { id: number; email_verified_at: string | null }
  expect(alice.email_verified_at).not.toBeNull()
  const authenticatedHome = await request('/', { cookie: aliceCookie })
  expect(authenticatedHome.status).toBe(200)
  const authenticatedHomeHtml = await authenticatedHome.text()
  expect(authenticatedHomeHtml).toContain('class="account-nav"')
  expect(authenticatedHomeHtml).toContain('@alice')
  expect(authenticatedHomeHtml).toContain('href="/account/edit?from=%2F">account</a>')
  expect(authenticatedHomeHtml).not.toContain('href="/login">login</a>')
  expect(authenticatedHomeHtml).toContain('class="notification-banner"')
  const accountFromLatest = await request('/account/edit?from=%2Flatest%3Fpage%3D2', { cookie: aliceCookie })
  expect(await accountFromLatest.text()).toContain('href="/latest?page=2">back</a>')
  const rememberedActivity = await request('/activity', { cookie: aliceCookie })
  expect(rememberedActivity.status).toBe(303)
  expect(rememberedActivity.headers.get('location')).toBe('/to-me')
  const activityHomeHtml = await (await request('/', { cookie: `${aliceCookie}; feed=activity` })).text()
  expect(activityHomeHtml).toContain('class="active" aria-current="page" href="/for-you"')
  expect(activityHomeHtml).toContain('<title>textlog</title>')
  for (const path of ['/for-you', '/hot', '/latest']) {
    expect(await (await request(path, { cookie: aliceCookie })).text()).toContain('class="notification-banner"')
  }
  const notificationSettings = await request('/account/edit/notifications', { cookie: aliceCookie })
  expect(notificationSettings.status).toBe(200)
  expect(await notificationSettings.text()).toContain('name="noteScope" checked="" value="latest"')
  const endpoint = 'https://push.example/alice-browser'
  const savedPush = await request('/account/push-subscription', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-browser',
    json: { endpoint, keys: { p256dh: 'test-key', auth: 'test-auth' },
      preferences: { latest: false, replies: true, mentions: false, follows: true, ownPosts: false } },
  })
  expect(savedPush.status).toBe(200)
  const deviceCookie = savedPush.headers.get('set-cookie')?.match(/notification_device=[^;]+/)?.[0]
  expect(deviceCookie).toBeDefined()
  const enabledDeviceHome = await (await request('/', { cookie: aliceCookie, userAgent: 'alice-browser' })).text()
  expect(enabledDeviceHome).not.toContain('class="notification-banner"')
  const otherBrowserHome = await (await request('/', { cookie: aliceCookie, userAgent: 'alice-other-browser' })).text()
  expect(otherBrowserHome).toContain('class="notification-banner"')
  const legacyDismissedHome = await (await request('/', {
    cookie: `${aliceCookie}; notification_banner_dismissed=${alice.id}`,
    userAgent: 'alice-legacy-browser',
  })).text()
  expect(legacyDismissedHome).not.toContain('class="notification-banner"')

  const dismissed = await request('/notifications/banner/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(dismissed.status).toBe(303)
  expect(dismissed.headers.get('set-cookie')).toBeNull()
  const dismissedHome = await (await request('/', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(dismissedHome).not.toContain('class="notification-banner"')
  const pushPreferences = await request(
    '/account/push-subscription?endpoint=' + encodeURIComponent(endpoint),
    { cookie: aliceCookie },
  )
  expect(await pushPreferences.json()).toEqual({
    enabled: true,
    preferences: { latest: 0, replies: 1, mentions: 0, follows: 1, ownPosts: 0, followActivity: 1, followingNotes: 1 },
  })
  const cacheBustedHomeHtml = await (await request('/?v=94721')).text()
  expect(cacheBustedHomeHtml).toContain(`property="og:url" content="${origin}/?v=94721"`)
  const publicExplore = await request('/explore', { cookie: aliceCookie })
  expect(publicExplore.status).toBe(200)
  const publicExploreHtml = await publicExplore.text()
  expect(publicExploreHtml).toContain('class="account-nav"')
  expect(publicExploreHtml).toContain('@alice')
  expect(publicExploreHtml).toContain('class="account-menu-handle" href="/u/alice?from=%2Fexplore"')
  expect(publicExploreHtml).toContain('href="/u/alice?from=%2Fexplore">profile</a>')
  expect(publicExploreHtml).toContain('action="/search"')
  expect(publicExploreHtml).toContain('placeholder="search notes, tags or people"')
  const noteSearchHtml = await (await request('/search?q=hello')).text()
  expect(noteSearchHtml).toContain('placeholder="search notes"')
  const tagSearchHtml = await (await request('/search?q=hello&tab=tags')).text()
  expect(tagSearchHtml).toContain('placeholder="search tags"')
  const peopleSearchHtml = await (await request('/search?q=hello&tab=people')).text()
  expect(peopleSearchHtml).toContain('placeholder="search people"')
  const welcomeExplore = await request('/explore?welcome=1', { cookie: aliceCookie })
  const welcomeExploreHtml = await welcomeExplore.text()
  expect(welcomeExploreHtml).toContain('href="/u/alice?from=%2Fexplore%3Fwelcome%3D1">profile</a>')
  expect(welcomeExploreHtml).not.toContain('action="/search"')
  expect(welcomeExploreHtml).toContain('href="/account/edit/notifications">enable notifications</a>')
  expect(welcomeExploreHtml).toContain('href="/account/edit/appearance">customize appearance</a>')
  expect(welcomeExploreHtml).toContain('href="/account/password/enable">set up a password</a>')
  const publicProfile = await request('/u/alice', { cookie: aliceCookie })
  expect(publicProfile.status).toBe(200)
  const missingProfile = await request('/u/foo', { cookie: aliceCookie })
  expect(missingProfile.status).toBe(404)
  expect(missingProfile.headers.get('content-type')).toContain('text/html')
  const missingProfileHtml = await missingProfile.text()
  expect(missingProfileHtml).toContain('<title>page not found · textlog</title>')
  expect(missingProfileHtml).toContain('class="account-nav"')
  const clientError = await request('/client-error')
  expect(clientError.status).toBe(400)
  expect(await clientError.text()).toContain('We couldn&#x27;t process that request.')
  expect(clientError.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  const serverError = await request('/server-error')
  expect(serverError.status).toBe(500)
  const serverErrorHtml = await serverError.text()
  expect(serverErrorHtml).toContain('Something went wrong.')
  expect(serverErrorHtml).not.toContain('Intentional server error route')
  expect(serverError.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(await publicProfile.text()).toContain('@alice')
  const publicTag = await request('/tag/onboarding', { cookie: aliceCookie })
  expect(publicTag.status).toBe(200)
  expect(await publicTag.text()).toContain('#onboarding')
  const mixedCaseTag = await request('/tag/OnBoarding?page=2', { cookie: aliceCookie })
  expect(mixedCaseTag.status).toBe(301)
  expect(mixedCaseTag.headers.get('location')).toBe('/tag/onboarding?page=2')

  const rawSession = aliceCookie.slice('textlog='.length)
  const storedSession = database.query('SELECT token_hash FROM sessions WHERE user_id=?')
    .get(alice.id) as { token_hash: string }
  expect(storedSession.token_hash).toHaveLength(64)
  expect(storedSession.token_hash).not.toBe(rawSession)

  const logout = await request('/logout', { method: 'POST', cookie: aliceCookie })
  expect(logout.status).toBe(303)
  expect((database.query('SELECT count(*) count FROM sessions WHERE user_id=?').get(alice.id) as any).count).toBe(0)

  aliceCookie = await signup('alice', 'alice@example.com', 'unused')
  const enablePasswordPage = await request('/account/password/enable', { cookie: aliceCookie })
  expect(enablePasswordPage.status).toBe(200)
  expect(await enablePasswordPage.text()).toContain('Enable password login')
  const passwordSetupRequest = await request('/account/password/enable', {
    method: 'POST',
    cookie: aliceCookie,
    form: {},
  })
  expect(passwordSetupRequest.status).toBe(200)
  const passwordSetupEmail = capturedEmails().filter(message =>
    message.to === 'alice@example.com'
    && message.subject.includes('Enable password login')
  ).at(-1)
  expect(passwordSetupEmail).toBeDefined()
  const passwordSetupToken = linkToken(passwordSetupEmail!)
  const passwordSetupPage = await request(
    `/account/password/enable?token=${encodeURIComponent(passwordSetupToken)}`,
    { cookie: aliceCookie },
  )
  expect(await passwordSetupPage.text()).toContain('Set a password')
  const enabledPassword = await request('/account/password/enable', {
    method: 'POST',
    cookie: aliceCookie,
    form: { token: passwordSetupToken, newPassword: 'alice password 123' },
  })
  expect(enabledPassword.status).toBe(303)
  expect(enabledPassword.headers.get('location')).toBe('/account/security?enabled=password')
  const rejectedPassword = await request('/enter/password', {
    method: 'POST',
    form: { nonce: await passwordLoginNonce(), identifier: '@alice', password: 'wrong password' },
  })
  const rejectedPasswordHtml = await rejectedPassword.text()
  expect(rejectedPasswordHtml).toContain('Login was unsuccessful. Check your details and try again.')
  expect(rejectedPasswordHtml).not.toContain('password is incorrect')
  const firstLoginNonce = await passwordLoginNonce()
  const passwordLogin = await request('/enter/password', {
    method: 'POST',
    form: { nonce: firstLoginNonce, identifier: '@alice', password: 'alice password 123', next: '/account/security' },
  })
  expect(passwordLogin.status).toBe(303)
  expect(passwordLogin.headers.get('location')).toBe('/account/security')
  aliceCookie = sessionCookie(passwordLogin)
  const replayedLogin = await request('/enter/password', {
    method: 'POST',
    form: { nonce: firstLoginNonce, identifier: '@alice', password: 'alice password 123' },
  })
  expect(replayedLogin.status).toBe(400)
  const replayedLoginHtml = await replayedLogin.text()
  expect(replayedLoginHtml).toContain('already used')
  expect(replayedLoginHtml).toContain('value="alice"')
  expect(replayedLoginHtml).not.toContain('alice password 123')
  const changedPassword = await request('/account/password/change', {
    method: 'POST',
    cookie: aliceCookie,
    form: { oldPassword: 'alice password 123', newPassword: 'alice password 456' },
  })
  expect(changedPassword.status).toBe(303)
  const forgotPassword = await request('/forgot-password', {
    method: 'POST',
    form: { email: 'alice@example.com' },
  })
  expect(forgotPassword.status).toBe(200)
  const resetEmail = capturedEmails().filter(message =>
    message.to === 'alice@example.com'
    && message.subject.includes('Reset your')
  ).at(-1)
  expect(resetEmail).toBeDefined()
  const resetToken = linkToken(resetEmail!)
  const resetPassword = await request('/reset-password', {
    method: 'POST',
    form: { token: resetToken, password: 'alice password 789', confirmPassword: 'alice password 789' },
  })
  expect(resetPassword.status).toBe(303)
  expect(resetPassword.headers.get('location')).toBe('/enter/password?reset=1')
  const reusedReset = await request(`/reset-password?token=${encodeURIComponent(resetToken)}`)
  expect(reusedReset.status).toBe(400)
  const resetLogin = await request('/enter/password', {
    method: 'POST',
    form: { nonce: await passwordLoginNonce(), identifier: 'alice@example.com', password: 'alice password 789' },
  })
  expect(resetLogin.status).toBe(303)
  aliceCookie = sessionCookie(resetLogin)

  const createPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A route-level integration post' },
  })
  expect(createPost.status).toBe(303)
  const post = database.query('SELECT id,body FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1')
    .get(alice.id) as { id: number; body: string }
  expect(createPost.headers.get('location')).toBe(`/latest#post-${post.id}`)

  const routeOversizedPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'x'.repeat(9 * 1024) },
  })
  expect(routeOversizedPost.status).toBe(413)
  expect(await routeOversizedPost.text()).toContain('That request was too large.')

  const globallyOversizedPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'x'.repeat(65 * 1024) },
  })
  expect(globallyOversizedPost.status).toBe(413)
  expect(await globallyOversizedPost.text()).toContain('That request was too large.')

  const unsupportedPost = await fetch(`${origin}/post`, {
    method: 'POST',
    headers: { origin, cookie: aliceCookie, 'content-type': 'application/json' },
    body: '{}',
    redirect: 'manual',
  })
  expect(unsupportedPost.status).toBe(415)
  expect(await unsupportedPost.text()).toContain('We couldn&#x27;t read that request.')

  expect(post.body).toBe('A route-level integration post')
  const invalidPostBody = `remember post ${'x'.repeat(270)}`
  const invalidPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: invalidPostBody },
  })
  expect(invalidPost.status).toBe(400)
  expect(await invalidPost.text()).toContain(invalidPostBody)
  const invalidReplyBody = `remember reply ${'x'.repeat(270)}`
  const invalidReply = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: invalidReplyBody },
  })
  expect(invalidReply.status).toBe(400)
  expect(await invalidReply.text()).toContain(invalidReplyBody)
  const invalidEditBody = `remember edit ${'x'.repeat(271)}`
  const invalidEdit = await request(`/post/${post.id}/edit`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: invalidEditBody },
  })
  expect(invalidEdit.status).toBe(400)
  expect(await invalidEdit.text()).toContain(invalidEditBody)
  const invalidProfile = await request('/account/edit', {
    method: 'POST',
    cookie: aliceCookie,
    form: { handle: 'Alice!', bio: 'remember profile bio' },
  })
  expect(invalidProfile.status).toBe(400)
  const invalidProfileHtml = await invalidProfile.text()
  expect(invalidProfileHtml).toContain('value="Alice!"')
  expect(invalidProfileHtml).toContain('You typed 6 characters.')
  expect(invalidProfileHtml).toContain('remember profile bio')
  const multilineBio = Array(6).fill('bio line').join('\n')
  const invalidMultilineBio = await request('/account/edit', {
    method: 'POST',
    cookie: aliceCookie,
    form: { handle: 'Alice', bio: multilineBio },
  })
  expect(invalidMultilineBio.status).toBe(400)
  const invalidMultilineBioHtml = await invalidMultilineBio.text()
  expect(invalidMultilineBioHtml).toContain('The bio exceeds the limit: 6/5 lines.')
  expect(invalidMultilineBioHtml).toContain(multilineBio)
  const search = await request('/search?q=route-level', { cookie: aliceCookie })
  expect(search.status).toBe(200)
  expect(search.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  const searchHtml = await search.text()
  expect(searchHtml).toContain('>1 notes</a>')
  expect(searchHtml).toContain('>0 tags</a>')
  expect(searchHtml).toContain('>0 people</a>')
  expect(searchHtml).toContain('A <mark>route</mark>-<mark>level</mark> integration post')
  database.query('INSERT OR IGNORE INTO post_hashtags(post_id,tag) VALUES(?,?)').run(post.id, 'routehelper')
  const hashtagHelper = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'replay this draft', action: 'search-hashtags', hashtag_query: '#route' },
  })
  expect(hashtagHelper.status).toBe(200)
  const hashtagHelperHtml = await hashtagHelper.text()
  expect(hashtagHelperHtml).toContain('>replay this draft</textarea>')
  expect(hashtagHelperHtml).toContain('name="hashtag_query" value="route"')
  expect(hashtagHelperHtml).toContain('#<mark>route</mark>helper')
  expect(hashtagHelperHtml).not.toContain('class="posting-help-more posting-help-search" open=""')
  const mentionHelper = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: '', action: 'search-mentions', mention_query: '@ali' },
  })
  expect(mentionHelper.status).toBe(200)
  const mentionHelperHtml = await mentionHelper.text()
  expect(mentionHelperHtml).toContain('@<mark>ali</mark>ce')
  expect(mentionHelperHtml).toContain('name="mention_query" value="ali"')
  expect(mentionHelperHtml).toContain('name="body" maxLength="280" required="" autofocus=""')
  expect(mentionHelperHtml).not.toContain('name="mention_query" maxLength="100" required=""')
  const implicitMentionHelper = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: '', action: 'search-hashtags', hashtag_query: '', mention_query: '@ali' },
  })
  expect(implicitMentionHelper.status).toBe(200)
  const implicitMentionHelperHtml = await implicitMentionHelper.text()
  expect(implicitMentionHelperHtml).toContain('@<mark>ali</mark>ce')
  expect(implicitMentionHelperHtml).not.toContain('No matching hashtags.')
  const publicPost = await request(`/post/${post.id}`)
  expect(publicPost.status).toBe(200)
  expect(publicPost.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=120')
  expect(publicPost.headers.get('vary')).toContain('Cookie')
  expect(await publicPost.text()).toContain(post.body)
  const navigatedPost = await request(`/post/${post.id}?from=${encodeURIComponent('/?cursor=legacy#post-1')}`)
  expect(navigatedPost.headers.get('x-robots-tag')).toBe('noindex, follow')
  expect(navigatedPost.headers.get('link')).toContain(`<${origin}/post/${post.id}>; rel="canonical"`)
  expect(navigatedPost.headers.get('link')).not.toContain('from=')
  expect(await navigatedPost.text()).toContain('rel="nofollow"')
  const crawledPost = await request(
    `/post/${post.id}?page=2&from=${encodeURIComponent('/latest#post-1')}`,
    { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  )
  expect(crawledPost.status).toBe(301)
  expect(crawledPost.headers.get('location')).toBe(`${origin}/post/${post.id}?page=2`)
  expect(crawledPost.headers.get('vary')).toContain('User-Agent')
  const crawledEntry = await request(
    `/enter?next=${encodeURIComponent(`/post/${post.id}?reply=1&from=${encodeURIComponent('/latest#post-1')}`)}`,
    { userAgent: 'Googlebot/2.1' },
  )
  expect(crawledEntry.status).toBe(301)
  expect(crawledEntry.headers.get('location')).toBe(`${origin}/post/${post.id}`)
  const crawledPasswordEntry = await request(
    `/enter/password?next=${
      encodeURIComponent(`/post/${post.id}?reply=1&from=${encodeURIComponent('/latest#post-1')}`)
    }`,
    { userAgent: 'Googlebot/2.1' },
  )
  expect(crawledPasswordEntry.status).toBe(301)
  expect(crawledPasswordEntry.headers.get('location')).toBe(`${origin}/post/${post.id}`)
  const crawledFeed = await request('/latest', { userAgent: 'Googlebot/2.1' })
  const crawledFeedHtml = await crawledFeed.text()
  expect(crawledFeedHtml).not.toContain('from=')
  expect(crawledFeedHtml).not.toContain('from%3D')
  expect(crawledFeed.headers.get('vary')).toContain('User-Agent')
  const blockedMeta = await request('/latest', { userAgent: 'meta-externalagent/1.1' })
  expect(blockedMeta.status).toBe(429)
  expect(blockedMeta.headers.get('retry-after')).toBe('31536000')
  const privatePost = await request(`/post/${post.id}`, { cookie: aliceCookie })
  expect(privatePost.headers.get('cache-control')).toBe('private, no-store')
  const privateReplyForm = await request(`/post/${post.id}?reply=1`, { cookie: aliceCookie })
  expect(privateReplyForm.headers.get('cache-control')).toBe('private, no-store')
  const ownThreadReply = database.query('INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?) RETURNING id')
    .get(alice.id, post.id, 'A reply in my own thread') as { id: number }
  const profileNotes = await (await request('/u/alice')).text()
  const profileReplies = await (await request('/u/alice?tab=replies')).text()
  expect(profileNotes).toContain('href="/u/alice?tab=replies"')
  expect(profileNotes).not.toContain('A reply in my own thread')
  expect(profileReplies).toContain('A reply in my own thread')
  expect(profileReplies).toContain('aria-current="page" href="/u/alice?tab=replies"')
  database.query('DELETE FROM posts WHERE id=?').run(ownThreadReply.id)
  const hotFeed = await request('/hot')
  expect(hotFeed.status).toBe(200)
  expect(await hotFeed.text()).not.toContain(post.body)

  const insertFeedPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?)')
  for (let index = 1; index <= 41; index++) insertFeedPost.run(alice.id, `cursor note ${index}`)
  const latestFirst = await request('/latest')
  const latestFirstBody = await latestFirst.text()
  const latestNext = latestFirstBody.match(/href="(\/latest\?page=2)"/)?.[1]
  expect(latestNext).toBeTruthy()
  expect(latestFirstBody).toContain('cursor note 41')
  expect(latestFirstBody).not.toContain(post.body)
  const latestSecondBody = await (await request(latestNext!)).text()
  expect(latestSecondBody).not.toContain(post.body)
  expect(latestSecondBody).toContain('← prev')
  expect(await (await request('/latest?page=3')).text()).toContain(post.body)

  const forYouFirstBody = await (await request('/for-you', { cookie: aliceCookie })).text()
  expect(forYouFirstBody).not.toContain('/for-you?cursor=')
  expect(forYouFirstBody).not.toContain('cursor note 41')
  expect(forYouFirstBody).not.toContain(post.body)
  expect(forYouFirstBody).not.toContain('action="/for-you/read-all"')
  expect(forYouFirstBody).not.toContain('class="for-you-item activity-item-unread"')

  const profileFirstBody = await (await request('/u/alice')).text()
  const profileNext = profileFirstBody.match(/href="(\/u\/alice\?page=2)"/)?.[1]
  expect(profileNext).toBeTruthy()
  expect(profileFirstBody).not.toContain(post.body)
  expect(await (await request(profileNext!)).text()).not.toContain(post.body)
  expect(await (await request('/u/alice?page=3')).text()).toContain(post.body)
  expect((await request('/latest?cursor=broken')).status).toBe(400)
  expect((await request('/for-you?cursor=broken', { cookie: aliceCookie })).status).toBe(400)
  expect((await request('/activity?cursor=broken', { cookie: aliceCookie })).status).toBe(303)
  expect((await request('/?cursor=broken', { cookie: aliceCookie })).status).toBe(400)
  expect((await request('/u/alice?cursor=broken')).status).toBe(400)

  const invalidIllegalActivity = await request('/report-illegal-activity', {
    method: 'POST',
    form: {
      contentUrl: `${origin}/post/${post.id}`,
      category: 'fraud',
      details: 'short but remembered',
      name: 'Remembered Reporter',
      email: 'not-an-email',
      goodFaith: 'yes',
    },
  })
  expect(invalidIllegalActivity.status).toBe(400)
  const invalidIllegalHtml = await invalidIllegalActivity.text()
  expect(invalidIllegalHtml).toContain('Remembered Reporter')
  expect(invalidIllegalHtml).toContain('not-an-email')
  expect(invalidIllegalHtml).toContain('checked=""')

  const illegalActivity = await request('/report-illegal-activity', {
    method: 'POST',
    form: {
      contentUrl: `${origin}/post/${post.id}`,
      category: 'fraud',
      details: 'This integration report provides enough detail about the allegedly illegal activity.',
      name: 'Public Reporter',
      email: 'reporter-public@example.com',
      goodFaith: 'yes',
    },
  })
  expect(illegalActivity.status).toBe(201)
  expect(await illegalActivity.text()).toContain('Your report was received')
  const illegalReport = database.query(`SELECT id,reference,status,reporter_email
    FROM illegal_activity_reports WHERE post_id=?`).get(post.id) as { id: number; reference: string; status: string;
    reporter_email: string }
  expect(illegalReport).toMatchObject({ status: 'open', reporter_email: 'reporter-public@example.com' })
  expect(capturedEmails().some(email =>
    email.to === 'reporter-public@example.com'
    && email.subject.includes('Report received')
  )).toBe(true)

  const bobCookie = await signup('bob', 'bob@example.com', 'bob password 123')
  const bob = database.query('SELECT id FROM users WHERE handle=?').get('bob') as { id: number }
  const followAlice = await request('/follow/alice', { method: 'POST', cookie: bobCookie, form: {} })
  expect(followAlice.status).toBe(303)
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(bob.id, alice.id))
    .toBeTruthy()
  const followBob = await request('/follow/bob', { method: 'POST', cookie: aliceCookie, form: {} })
  expect(followBob.status).toBe(303)
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(alice.id, bob.id))
    .toBeTruthy()
  database.query('UPDATE follows SET created_at=\'2099-01-01 00:00:00\' WHERE follower_id=? AND following_id=?')
    .run(bob.id, alice.id)
  database.query('UPDATE users SET bio=\'Bob builds things\' WHERE id=?').run(bob.id)
  const followedPersonFeed = await (await request('/for-you', { cookie: aliceCookie })).text()
  expect(followedPersonFeed).toContain('<a class="reference-menu-trigger postauthor" '
    + 'href="/u/bob?from=%2Ffor-you%23activity-user-follow-')
  expect(followedPersonFeed).toContain('<span class="reference-profile-tabs"><a '
    + 'href="/u/bob?from=%2Ffor-you%23activity-user-follow-')
  expect(followedPersonFeed).toContain('<a href="/u/bob?tab=replies&amp;from=%2Ffor-you%23activity-user-follow-')
  expect(followedPersonFeed).toContain('<span class="reference-popover-bio">Bob builds things</span>'
    + '<span class="reference-popover-actions"><form action="/follow/bob" method="post">'
    + '<input type="hidden" name="from" value="/for-you#activity-user-follow-')
  expect(followedPersonFeed).toContain('<button '
    + 'class="button button-muted" type="submit">unfollow</button>')
  expect(followedPersonFeed).toContain('<form action="/block/bob" method="post">'
    + '<button class="quiet danger" type="submit">block</button></form>')
  expect(followedPersonFeed).toContain('<p class="profile-bio">Bob builds things</p>')
  expect(followedPersonFeed).toContain('action="/follow/bob"')
  expect(followedPersonFeed).not.toContain('action="/follow/alice"')
  expect(followedPersonFeed).not.toContain('action="/for-you/read-all"')
  expect(followedPersonFeed).not.toContain('you&#x27;ve seen it all')
  expect(followedPersonFeed).toContain('href="/for-you"><span class="unread-dot" aria-hidden="true"></span>')
  expect(followedPersonFeed).toContain('href="/to-me"><span class="unread-dot" aria-hidden="true"></span>'
    + '<span class="visually-hidden">unread</span>to me</a>')
  expect(followedPersonFeed).toContain('activity-follow activity-item-unread')
  expect(followedPersonFeed).toContain('class="unread-dot" aria-label="unread"')
  const enableBot = await request('/account/edit', {
    method: 'POST', cookie: bobCookie, form: { handle: 'bob', bio: 'Bob builds things', isBot: 'yes' },
  })
  expect(enableBot.status).toBe(303)
  expect(database.query('SELECT is_bot FROM users WHERE id=?').get(bob.id)).toEqual({ is_bot: 1 })
  const botSettings = await (await request('/account/edit', { cookie: bobCookie })).text()
  expect(botSettings).toContain('role="switch" name="isBot" checked=""')
  expect(botSettings).toContain('value="yes"')
  const botPostBody = 'A bot-only timeline note'
  expect((await request('/post', { method: 'POST', cookie: bobCookie, form: { body: botPostBody } })).status).toBe(303)
  const botPost = database.query('SELECT id FROM posts WHERE user_id=? AND body=?').get(bob.id, botPostBody) as {
    id: number
  }
  expect(await (await request('/latest')).text()).not.toContain(botPostBody)
  expect(await (await request('/u/bob')).text()).toContain(botPostBody)
  expect(await (await request('/for-you', { cookie: aliceCookie })).text()).toContain(botPostBody)
  database.query('INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?)')
    .run(alice.id, botPost.id, 'A human reply quoting the bot')
  const latestWithBotQuote = await (await request('/latest')).text()
  expect(latestWithBotQuote).toContain('A human reply quoting the bot')
  expect(latestWithBotQuote).toContain(botPostBody)
  const markedForYou = await request('/for-you/read-all', { method: 'POST', cookie: aliceCookie })
  expect(markedForYou.status).toBe(303)
  expect(markedForYou.headers.get('location')).toBe('/for-you')
  const readForYou = await (await request('/for-you', { cookie: aliceCookie })).text()
  expect(readForYou).not.toContain('action="/for-you/read-all"')
  expect(readForYou).not.toContain('you&#x27;ve seen it all')
  const blockBob = await request('/block/bob', { method: 'POST', cookie: aliceCookie })
  expect(blockBob.status).toBe(303)
  expect(database.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(alice.id, bob.id)).toBeTruthy()
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(alice.id, bob.id))
    .toBeNull()
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(bob.id, alice.id))
    .toBeTruthy()
  const unblockBob = await request('/block/bob', { method: 'POST', cookie: aliceCookie })
  expect(unblockBob.status).toBe(303)
  expect(database.query('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(alice.id, bob.id)).toBeNull()
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(alice.id, bob.id))
    .toBeNull()
  expect(database.query('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(bob.id, alice.id))
    .toBeTruthy()
  await request('/tag-follow/shared', { method: 'POST', cookie: aliceCookie })
  await request('/tag-follow/shared', { method: 'POST', cookie: bobCookie })
  const unicodeTagFollow = await request('/tag-follow/' + encodeURIComponent('español'), {
    method: 'POST',
    cookie: aliceCookie,
    form: { from: '/latest#post-2' },
  })
  expect(unicodeTagFollow.status).toBe(303)
  expect(unicodeTagFollow.headers.get('location')).toBe('/latest#post-2')
  expect(database.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=\'español\'').get(alice.id)).toBeTruthy()
  const invalidTagFollow = await request('/tag-follow/not-a-tag', { method: 'POST', cookie: aliceCookie })
  expect(invalidTagFollow.status).toBe(400)
  expect(invalidTagFollow.headers.get('content-type')).toBe('text/html;charset=utf-8')
  expect(await invalidTagFollow.text()).toContain('We couldn&#x27;t process that request.')
  database.query('UPDATE hashtag_follows SET created_at=\'2099-01-02 00:00:00\' WHERE user_id=? AND tag=\'shared\'')
    .run(bob.id)
  const followedTagFeed = await (await request('/for-you', { cookie: aliceCookie })).text()
  expect(followedTagFeed).toContain('<a class="reference-menu-trigger postauthor" '
    + 'href="/u/bob?from=%2Ffor-you%23activity-tag-follow-')
  expect(followedTagFeed).toContain('<span class="reference-popover-bio">Bob builds things</span>')
  expect(followedTagFeed).toContain('<a href="/tag/shared?from=%2Ffor-you%23activity-tag-follow-')
  expect(followedTagFeed).toContain('<a class="activity-follow-stats" href="/tag/shared?from=')
  expect(followedTagFeed).toContain('<time dateTime="2099-01-02 00:00:00"')
  expect(followedTagFeed).toContain('<span aria-hidden="true">·</span><span>0 notes</span></a>')
  expect(followedTagFeed).not.toContain('@alice</a><span>followed</span><a href="/tag/shared">#shared</a>')
  const sharedReplyResponse = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: bobCookie,
    form: { body: 'shared reply #shared',
      from: `/post/${post.id}?from=%2Flatest%3Fcursor%3Dabc%23post-1#post-${post.id}` },
  })
  expect(sharedReplyResponse.status).toBe(303)
  const sharedReply = database.query('SELECT id FROM posts WHERE user_id=? AND body=?').get(
    bob.id,
    'shared reply #shared',
  ) as { id: number }
  const hashtagBotPost = await request('/post', {
    method: 'POST', cookie: bobCookie, form: { body: 'Bot note discovered through #shared' },
  })
  expect(hashtagBotPost.status).toBe(303)
  const hashtagForYou = await (await request('/for-you', { cookie: aliceCookie })).text()
    + await (await request('/for-you?page=2', { cookie: aliceCookie })).text()
  expect(hashtagForYou).toContain('Bot note discovered through')
  expect(sharedReplyResponse.headers.get('location')).toBe(
    `/post/${post.id}?from=%2Flatest%3Fcursor%3Dabc%23post-1#post-${sharedReply.id}`,
  )
  const sharedReplyPage = await request(sharedReplyResponse.headers.get('location')!, { cookie: bobCookie })
  const sharedReplyHtml = await sharedReplyPage.text()
  expect(sharedReplyHtml).toContain(
    'class="quiet post-back-link" href="/latest?cursor=abc#post-1">back</a>',
  )
  const threadProfileHref = `/u/bob?from=${
    encodeURIComponent(
      `/post/${post.id}?from=%2Flatest%3Fcursor%3Dabc%23post-1`,
    )
  }`.replaceAll('&', '&amp;')
  expect(sharedReplyHtml).toContain(`class="account-menu-handle" href="${threadProfileHref}">@bob</a>`)
  expect(sharedReplyHtml).toContain(`href="${threadProfileHref}">profile</a>`)
  const activityReadKey = `post:${sharedReply.id}`
  const forYouReadKey = `post:${String(sharedReply.id).padStart(20, '0')}`
  const visitedGeneralPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?) RETURNING id')
    .get(bob.id, 'general note read by visiting for you #shared') as { id: number }
  database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(?,?)').run(visitedGeneralPost.id, 'shared')
  const visitedGeneralReadKey = `post:${String(visitedGeneralPost.id).padStart(20, '0')}`

  await request('/for-you', { cookie: aliceCookie })
  expect(database.query('SELECT 1 FROM activity_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, activityReadKey)).toBeNull()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, forYouReadKey)).toBeNull()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, visitedGeneralReadKey)).toBeTruthy()

  const unreadToMeHtml = await (await request('/to-me', { cookie: aliceCookie })).text()
  expect(unreadToMeHtml).not.toContain('action="/to-me/read-all"')
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, forYouReadKey)).toBeTruthy()

  const generalFeedPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?) RETURNING id')
    .get(bob.id, 'unread general feed note') as { id: number }
  const generalFeedReadKey = `post:${String(generalFeedPost.id).padStart(20, '0')}`
  await request('/to-me/read-all', { method: 'POST', cookie: aliceCookie })
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, forYouReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, generalFeedReadKey)).toBeNull()

  const bulkTargetedReply = database.query(
    'INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?) RETURNING id',
  ).get(bob.id, post.id, 'targeted reply left for to me') as { id: number }
  const bulkTargetedReadKey = `post:${String(bulkTargetedReply.id).padStart(20, '0')}`
  const bulkGeneralPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?) RETURNING id')
    .get(bob.id, 'general note cleared by for you #shared') as { id: number }
  database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(?,?)').run(bulkGeneralPost.id, 'shared')
  const bulkGeneralReadKey = `post:${String(bulkGeneralPost.id).padStart(20, '0')}`
  await request('/for-you/read-all', { method: 'POST', cookie: aliceCookie })
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, bulkGeneralReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, bulkTargetedReadKey)).toBeNull()

  const insertActivityReply = database.query(
    'INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,?,?,?)',
  )
  for (let index = 1; index <= 41; index++) {
    const createdAt = new Date(Date.UTC(2080, 0, index, 12)).toISOString().replace('T', ' ').slice(0, 19)
    insertActivityReply.run(bob.id, post.id, index === 1 ? 'oldest cursor boundary' : `activity cursor reply ${index}`,
      createdAt)
  }
  const activityFirstBody = await (await request('/to-me', { cookie: aliceCookie })).text()
  const activityNext = activityFirstBody.match(/href="(\/to-me\?page=2)"/)?.[1]
  expect(activityNext).toBeTruthy()
  expect(activityFirstBody).toContain('activity cursor reply 41')
  expect(activityFirstBody).not.toContain('oldest cursor boundary')
  insertActivityReply.run(bob.id, post.id, 'newer activity after cursor', '2080-02-01 12:00:00')
  const activitySecondBody = await (await request(activityNext!, { cookie: aliceCookie })).text()
  expect(activitySecondBody).not.toContain('oldest cursor boundary')
  expect(activitySecondBody).not.toContain('activity cursor reply 41')
  expect(activitySecondBody).toContain('← prev')
  expect(await (await request('/to-me?page=3', { cookie: aliceCookie })).text()).toContain('oldest cursor boundary')
  const invalidReport = await request(`/post/${post.id}/report`, {
    method: 'POST',
    cookie: bobCookie,
    form: { reason: 'remember-invalid-reason' },
  })
  expect(invalidReport.status).toBe(400)
  const invalidReportHtml = await invalidReport.text()
  expect(invalidReportHtml).toContain('value="remember-invalid-reason"')
  expect(invalidReportHtml).toContain('hidden="" selected=""')
  const report = await request(`/post/${post.id}/report`, {
    method: 'POST',
    cookie: bobCookie,
    form: { reason: 'spam' },
  })
  expect(report.status).toBe(303)
  expect(report.headers.get('location')).toBe(`/post/${post.id}?reported=1`)
  const reportRow = database.query('SELECT id,status,reason FROM reports WHERE reporter_id=? AND post_id=?')
    .get(bob.id, post.id) as { id: number; status: string; reason: string }
  expect(reportRow).toMatchObject({ status: 'open', reason: 'spam' })

  const emailDeleteCookie = await signup('emaildelete', 'email-delete@example.com', 'unused')
  const emailChangeRequest = await request('/account/email/change', {
    method: 'POST',
    cookie: emailDeleteCookie,
    form: { email: 'email-delete-new@example.com' },
  })
  expect(emailChangeRequest.status).toBe(200)
  expect((database.query('SELECT email FROM users WHERE handle=?').get('emaildelete') as { email: string }).email)
    .toBe('email-delete@example.com')
  const approvalEmail = capturedEmails().filter(message =>
    message.to === 'email-delete@example.com'
    && message.subject.includes('Approve email change')
  ).at(-1)
  expect(approvalEmail).toBeDefined()
  const approvalToken = linkToken(approvalEmail!)
  expect((await request(`/account/email/change/authorize?token=${encodeURIComponent(approvalToken)}`)).status).toBe(200)
  const approvedChange = await request('/account/email/change/authorize', {
    method: 'POST',
    form: { token: approvalToken },
  })
  expect(approvedChange.status).toBe(200)
  const newEmailConfirmation = capturedEmails().filter(message =>
    message.to === 'email-delete-new@example.com'
    && message.subject.includes('Confirm new email')
  ).at(-1)
  expect(newEmailConfirmation).toBeDefined()
  const newEmailToken = linkToken(newEmailConfirmation!)
  const changedEmail = await request('/verify-email', { method: 'POST', form: { token: newEmailToken } })
  expect(changedEmail.status).toBe(303)
  expect((database.query('SELECT email FROM users WHERE handle=?').get('emaildelete') as { email: string }).email)
    .toBe('email-delete-new@example.com')

  const emailDeleteRequest = await request('/account/delete', {
    method: 'POST',
    cookie: emailDeleteCookie,
    form: {},
  })
  expect(emailDeleteRequest.status).toBe(200)
  expect(
    (database.query('SELECT deleted_at FROM users WHERE handle=?').get('emaildelete') as { deleted_at: string | null })
      .deleted_at,
  ).toBeNull()
  const deleteEmail = capturedEmails().filter(message =>
    message.to === 'email-delete-new@example.com'
    && message.subject.includes('Confirm account deletion')
  ).at(-1)
  expect(deleteEmail).toBeDefined()
  const deletionToken = linkToken(deleteEmail!)
  const deletionReview = await request(`/account/delete?token=${encodeURIComponent(deletionToken)}`)
  expect(deletionReview.status).toBe(200)
  expect(
    (database.query('SELECT deleted_at FROM users WHERE handle=?').get('emaildelete') as { deleted_at: string | null })
      .deleted_at,
  ).toBeNull()
  const confirmedDeletion = await request('/account/delete', {
    method: 'POST',
    form: { token: deletionToken },
  })
  expect(confirmedDeletion.status).toBe(303)
  expect(database.query('SELECT 1 FROM users WHERE handle=?').get('emaildelete')).toBeNull()

  const passwordDeleteCookie = await signup('passworddelete', 'password-delete@example.com', 'unused')
  await request('/account/password/enable', { method: 'POST', cookie: passwordDeleteCookie, form: {} })
  const deletePasswordEmail = capturedEmails().filter(message =>
    message.to === 'password-delete@example.com'
    && message.subject.includes('Enable password login')
  ).at(-1)
  expect(deletePasswordEmail).toBeDefined()
  await request('/account/password/enable', {
    method: 'POST',
    cookie: passwordDeleteCookie,
    form: { token: linkToken(deletePasswordEmail!), newPassword: 'delete password 123' },
  })
  const rejectedDeletion = await request('/account/delete', {
    method: 'POST',
    cookie: passwordDeleteCookie,
    form: { password: 'wrong password' },
  })
  expect(rejectedDeletion.status).toBe(400)
  expect(database.query('SELECT 1 FROM users WHERE handle=? AND deleted_at IS NULL').get('passworddelete'))
    .toBeTruthy()
  const passwordDeletion = await request('/account/delete', {
    method: 'POST',
    cookie: passwordDeleteCookie,
    form: { password: 'delete password 123' },
  })
  expect(passwordDeletion.status).toBe(303)
  expect(database.query('SELECT 1 FROM users WHERE handle=?').get('passworddelete')).toBeNull()

  const adminCookie = await signup('admin', 'gstagas@gmail.com', 'admin password 123')
  const adminActivity = await (await request('/for-you', { cookie: adminCookie })).text()
  expect(adminActivity).toContain('>@admin</a>')
  expect(adminActivity).toContain('>@alice</a>')
  expect(adminActivity).toContain('<span class="activity-context">signed up:</span>')
  expect(adminActivity).toContain('<a class="activity-follow-stats" href="/u/alice?from=%2Ffor-you%23activity-signup-')
  expect(adminActivity).not.toContain('href="/tag/null"')
  expect(adminActivity).not.toContain('>#null</a>')
  expect(adminActivity).toContain('activity-follow')
  expect(adminActivity).toContain('<p class="profile-bio">No bio yet.</p>')
  expect(adminActivity).toContain('action="/follow/alice"')
  expect(adminActivity).toContain('<button class="button">follow</button>')
  expect(adminActivity).not.toContain('action="/follow/admin"')
  expect(adminActivity).not.toContain('action="/for-you/read-all"')
  const markedActivity = await request('/activity/read-all', { method: 'POST', cookie: adminCookie })
  expect(markedActivity.status).toBe(303)
  expect(markedActivity.headers.get('location')).toBe('/to-me')
  const readAdminActivity = await (await request('/for-you', { cookie: adminCookie })).text()
  expect(readAdminActivity).not.toContain('action="/for-you/read-all"')
  expect(readAdminActivity).not.toContain('you&#x27;ve seen it all')
  const ordinaryActivity = await (await request('/for-you', { cookie: aliceCookie })).text()
  expect(ordinaryActivity).not.toContain('signed up:</span>')
  const dashboard = await request('/admin', { cookie: adminCookie })
  expect(dashboard.status).toBe(200)
  expect(await dashboard.text()).toContain('A route-level integration post')
  const emailPage = await request('/admin/email', { cookie: adminCookie })
  expect(emailPage.status).toBe(200)
  expect(await emailPage.text()).toContain('action="/admin/email"')
  const sendEmail = await request('/admin/email', {
    method: 'POST',
    cookie: adminCookie,
    form: { email: 'recipient@example.com', title: 'A custom title', body: 'Hello <friend>!' },
  })
  expect(sendEmail.status).toBe(303)
  expect(sendEmail.headers.get('location')).toBe('/admin/email?sent=1')
  expect(capturedEmails().at(-1)).toMatchObject({
    to: 'recipient@example.com',
    subject: 'A custom title',
    text: 'Hello <friend>!',
  })
  expect(capturedEmails().at(-1)?.html).toContain('<title>A custom title · textlog</title>')
  expect(capturedEmails().at(-1)?.html).toContain('Hello &lt;friend&gt;!')
  const resolveIllegalReport = await request(`/admin/illegal-reports/${illegalReport.id}/resolve`, {
    method: 'POST',
    cookie: adminCookie,
    form: { reasons: 'Confirmed and actioned after human review of the report.' },
  })
  expect(resolveIllegalReport.status).toBe(303)
  expect((database.query('SELECT status FROM illegal_activity_reports WHERE id=?')
    .get(illegalReport.id) as { status: string }).status).toBe('resolved')
  expect(capturedEmails().some(email =>
    email.to === 'reporter-public@example.com'
    && email.subject.includes('Report decision')
  )).toBe(true)

  const resolveReport = await request(`/admin/reports/${reportRow.id}/resolve`, {
    method: 'POST',
    cookie: adminCookie,
    form: { note: 'Resolved by integration test' },
  })
  expect(resolveReport.status).toBe(303)
  expect((database.query('SELECT status FROM reports WHERE id=?').get(reportRow.id) as any).status).toBe('resolved')
  expect(database.query('SELECT action,note FROM admin_actions WHERE target_post_id=? ORDER BY id DESC LIMIT 1')
    .get(post.id)).toEqual({ action: 'resolve_report', note: 'Resolved by integration test' })

  const moderateBob = await request(`/admin/users/${bob.id}`, { cookie: adminCookie })
  expect(await moderateBob.text()).toContain('take permanent control of bot status')
  const enforceBot = await request(`/admin/users/${bob.id}/bot`, {
    method: 'POST', cookie: adminCookie, form: { bot: 'yes', note: 'Automated account' },
  })
  expect(enforceBot.status).toBe(303)
  expect(database.query('SELECT is_bot,bot_managed FROM users WHERE id=?').get(bob.id))
    .toEqual({ is_bot: 1, bot_managed: 1 })
  const lockedBotSettings = await (await request('/account/edit', { cookie: bobCookie })).text()
  expect(lockedBotSettings).toContain('A moderator permanently controls this setting.')
  expect(lockedBotSettings).toContain('role="switch" disabled="" name="isBot" checked=""')
  const ownerCannotRemoveBot = await request('/account/edit', {
    method: 'POST', cookie: bobCookie, form: { handle: 'bob', bio: 'Bob builds things' },
  })
  expect(ownerCannotRemoveBot.status).toBe(303)
  expect(database.query('SELECT is_bot,bot_managed FROM users WHERE id=?').get(bob.id))
    .toEqual({ is_bot: 1, bot_managed: 1 })

  const suspend = await request(`/admin/users/${bob.id}/suspend`, {
    method: 'POST',
    cookie: adminCookie,
    form: { note: 'Suspend integration account' },
  })
  expect(suspend.status).toBe(303)
  expect((database.query('SELECT suspended_at FROM users WHERE id=?').get(bob.id) as any).suspended_at).not.toBeNull()
  expect((database.query('SELECT count(*) count FROM sessions WHERE user_id=?').get(bob.id) as any).count).toBe(0)

  const restore = await request(`/admin/users/${bob.id}/restore`, {
    method: 'POST',
    cookie: adminCookie,
    form: { note: 'Restore integration account' },
  })
  expect(restore.status).toBe(303)
  expect((database.query('SELECT suspended_at FROM users WHERE id=?').get(bob.id) as any).suspended_at).toBeNull()
  const userActions = database.query('SELECT action FROM admin_actions WHERE target_user_id=? ORDER BY id').all(bob.id)
  expect(userActions).toEqual([
    { action: 'mark_bot' },
    { action: 'suspend_user' },
    { action: 'restore_user' },
  ])
}, 60_000)
