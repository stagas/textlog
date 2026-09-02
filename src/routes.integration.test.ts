import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { Database } from 'bun:sqlite'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { issueInteractedUnsubscribeToken } from './interacted-emails'
import { issueRecapUnsubscribeToken } from './recap-emails'
import { insertSession, SESSION_LIFETIME_MS } from './sessions'

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
  acceptHtml?: boolean
} = {}) {
  const method = options.method || 'GET'
  const headers = new Headers()
  if (options.cookie) headers.set('cookie', options.cookie)
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  if (options.userAgent) headers.set('user-agent', options.userAgent)
  if (options.ip) headers.set('x-forwarded-for', options.ip)
  if (options.acceptHtml) headers.set('accept', 'text/html')
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

test('web manifest is cached by browsers', async () => {
  const response = await request('/site.webmanifest')

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(response.headers.get('cache-control')).toBe('public, max-age=86400, stale-while-revalidate=604800')
  expect(await response.json()).toMatchObject({
    theme_color: '#e5e8e1',
    background_color: '#171a17',
    start_url: '/?pwa',
  })
})

test('PWA launch marks the client standalone and removes the launch parameter', async () => {
  const response = await request('/?pwa')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/')
  expect(response.headers.get('set-cookie')).toContain('pwa_standalone=1')
})

test('mobile browsers see an install banner and can dismiss it', async () => {
  const userAgent = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile'
  const mobile = await request('/about', { userAgent })
  const mobileHtml = await mobile.text()
  expect(mobileHtml).toContain('install to home screen')
  expect(mobileHtml).toContain('get mobile app')

  const standalone = await request('/about', { userAgent, cookie: 'pwa_standalone=1' })
  const standaloneHtml = await standalone.text()
  expect(standaloneHtml).not.toContain('install to home screen')
  expect(standaloneHtml).not.toContain('get mobile app')

  const dismissed = await request('/install/banner/dismiss', { method: 'POST', userAgent, form: {} })
  expect(dismissed.headers.get('set-cookie')).toContain('pwa_install_banner_dismissed=1')

  const anonymousDismissal = await fetch(`${origin}/install/banner/dismiss`, {
    method: 'POST',
    redirect: 'manual',
  })
  expect(anonymousDismissal.status).toBe(303)
  expect(anonymousDismissal.headers.get('set-cookie')).toContain('pwa_install_banner_dismissed=1')
})

test('install guide is tailored to the mobile browser', async () => {
  const response = await request('/install', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18 Mobile Safari/604.1',
  })
  const html = await response.text()
  expect(html).toContain('iPhone or iPad · Safari')
  expect(html).toContain('Add to Home Screen')

  const chrome = await request('/install', {
    userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile',
  })
  expect(await chrome.text()).toContain('Install and create shortcut')
})

test('/?reddit counts each IP once', async () => {
  const attributed = await request('/?reddit', { ip: '203.0.113.80' })
  expect(attributed.status).toBe(303)
  expect(attributed.headers.get('set-cookie')).toContain('campaign_attribution=reddit')
  expect((await request('/?reddit', { ip: '203.0.113.80' })).status).toBe(303)
  expect((await request('/?reddit', { ip: '203.0.113.81' })).status).toBe(303)
  expect((await request('/', { ip: '203.0.113.82' })).status).toBe(303)

  expect(database.query(`SELECT count(*) count FROM campaign_visitors WHERE campaign='reddit'`).get())
    .toEqual({ count: 2 })
})

test('/?reddit attributes a completed signup', async () => {
  const landing = await request('/?reddit', { ip: '203.0.113.83' })
  const attributionCookie = landing.headers.get('set-cookie')!.split(';', 1)[0]
  const email = 'reddit-attributed@example.com'
  expect((await request('/enter', {
    method: 'POST',
    cookie: attributionCookie,
    form: { email },
    ip: '203.0.113.83',
  })).status).toBe(200)
  const emailMessage = capturedEmails().filter(message => message.to === email).at(-1)!
  const magic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(emailMessage))}`, {
    cookie: attributionCookie,
  })
  const cookie = `${sessionCookie(magic)}; ${attributionCookie}`
  const chosen = await request('/choose-handle', {
    method: 'POST',
    cookie,
    form: { handle: 'reddit_user', next: '/explore' },
  })

  expect(chosen.status).toBe(303)
  expect(chosen.headers.get('set-cookie')).toContain('campaign_attribution=; Max-Age=0')
  expect(database.query(`SELECT count(*) count FROM campaign_signups WHERE campaign='reddit'`).get())
    .toEqual({ count: 1 })
})

test('an anonymous feed note is published after signup chooses a handle', async () => {
  const body = 'A thought carried through signup'
  const ip = '203.0.113.84'
  const draftsBeforePreview = (database.query('SELECT count(*) count FROM drafts').get() as { count: number }).count
  const preview = await request('/post', {
    method: 'POST',
    ip,
    form: { body, from: '/hot', embedded: '1', action: 'preview' },
  })
  expect(preview.status).toBe(200)
  const previewHtml = await preview.text()
  expect(previewHtml).toContain('<h2>preview</h2>')
  expect(previewHtml).toContain(body)
  expect(previewHtml).toContain('anonymous-write-compose')
  expect(preview.headers.get('set-cookie')).toBeNull()
  expect((database.query('SELECT count(*) count FROM drafts').get() as { count: number }).count)
    .toBe(draftsBeforePreview)

  const autotag = await request('/post', {
    method: 'POST',
    ip,
    form: { body, from: '/hot', embedded: '1', action: 'autotag' },
  })
  expect(autotag.status).toBe(503)
  const autotagHtml = await autotag.text()
  expect(autotagHtml).toContain('Autotag is not configured.')
  expect(autotagHtml).toContain('anonymous-write-compose')
  expect(autotag.headers.get('location')).toBeNull()

  const started = await request('/post', {
    method: 'POST',
    ip,
    form: { body, from: '/hot', embedded: '1' },
  })
  expect(started.status).toBe(303)
  expect(started.headers.get('location')).toBe('/enter?next=%2Fpending-post')
  const pendingCookie = started.headers.get('set-cookie')!.split(';', 1)[0]
  expect(pendingCookie).toStartWith('pending_post=')

  const email = 'pending-post-signup@example.com'
  const sent = await request('/enter', {
    method: 'POST',
    ip,
    cookie: pendingCookie,
    form: { email, next: '/pending-post' },
  })
  expect(sent.status).toBe(200)
  const message = capturedEmails().filter(item => item.to === email).at(-1)!
  const magic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(message))}`, {
    cookie: pendingCookie,
    ip,
  })
  const loginCookie = sessionCookie(magic)
  expect(magic.headers.get('location')).toBe('/choose-handle?next=%2Fpending-post')

  const cookies = `${loginCookie}; ${pendingCookie}`
  const chosen = await request('/choose-handle', {
    method: 'POST',
    cookie: cookies,
    ip,
    form: { handle: 'pending_writer', next: '/pending-post' },
  })
  expect(chosen.headers.get('location')).toBe('/pending-post')

  const published = await request('/pending-post', { cookie: cookies, acceptHtml: true, ip })
  expect(published.status).toBe(303)
  expect(published.headers.get('location')).toBe('/hot')
  expect(published.headers.get('set-cookie')).toContain('pending_post=')
  expect(published.headers.get('set-cookie')).toContain('Max-Age=0')
  const root = database.query('SELECT id,body FROM posts WHERE user_id=(SELECT id FROM users WHERE handle=?) ORDER BY id DESC')
    .get('pending_writer') as { id: number; body: string }
  expect(root.body).toBe(body)

  const replyBody = 'A reply carried through signup'
  const replyIp = '203.0.113.85'
  const replyStarted = await request(`/post/${root.id}/reply`, {
    method: 'POST',
    ip: replyIp,
    form: { body: replyBody, reply_page_id: String(root.id), from: `/post/${root.id}` },
  })
  expect(replyStarted.headers.get('location')).toBe('/enter?next=%2Fpending-post')
  const replyPendingCookie = replyStarted.headers.get('set-cookie')!.split(';', 1)[0]
  const replyEmail = 'pending-reply-signup@example.com'
  await request('/enter', {
    method: 'POST',
    ip: replyIp,
    cookie: replyPendingCookie,
    form: { email: replyEmail, next: '/pending-post' },
  })
  const replyMessage = capturedEmails().filter(item => item.to === replyEmail).at(-1)!
  const replyMagic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(replyMessage))}`, {
    cookie: replyPendingCookie,
    ip: replyIp,
  })
  const replyCookies = `${sessionCookie(replyMagic)}; ${replyPendingCookie}`
  await request('/choose-handle', {
    method: 'POST',
    cookie: replyCookies,
    ip: replyIp,
    form: { handle: 'pending_replier', next: '/pending-post' },
  })
  const replyPublished = await request('/pending-post', { cookie: replyCookies, acceptHtml: true, ip: replyIp })
  expect(replyPublished.status).toBe(303)
  expect(replyPublished.headers.get('location')).toContain(`/post/${root.id}`)
  const reply = database.query('SELECT id,body,parent_id FROM posts WHERE user_id=(SELECT id FROM users WHERE handle=?)')
    .get('pending_replier') as { id: number; body: string; parent_id: number }
  expect(reply).toMatchObject({ body: replyBody, parent_id: root.id })

  const clickedReply = await request(`/post/${root.id}?from=${encodeURIComponent(`/hot#post-${reply.id}`)}`)
  const clickedReplyHtml = await clickedReply.text()
  expect(clickedReplyHtml).toContain('class="inline-reply-compose"')
  expect(clickedReplyHtml).toContain(`action="/post/${reply.id}/reply#post-${reply.id}"`)
  expect(clickedReplyHtml.indexOf(`id="post-${reply.id}"`))
    .toBeLessThan(clickedReplyHtml.indexOf('anonymous-reply-compose'))
})

test('instant scroll actions are applied once without client-side scripts', async () => {
  const marked = await request('/about?_scroll=instant')
  expect(marked.status).toBe(303)
  expect(marked.headers.get('location')).toBe('/about')
  expect(marked.headers.get('set-cookie')).toContain('textlog_scroll=instant')

  const destination = await request('/about', { cookie: 'textlog_scroll=instant' })
  const html = await destination.text()
  expect(html).toContain('<html lang="en" class="scroll-instant">')
  expect(html).not.toContain('<script')
  expect(destination.headers.get('set-cookie')).toContain('textlog_scroll=; Max-Age=0')
})

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
    expect(chosen.headers.get('location')).toBe('/explore')
    expect(chosen.headers.get('set-cookie')).toContain('explore_welcome=1')
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
      IP_PSEUDONYM_SECRET: 'route-integration-ip-secret',
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

test('email unsubscribe links bypass handle selection for unfinished signups', async () => {
  const email = 'unfinished-unsubscribe@example.com'
  const user = database.query(`INSERT INTO users(handle,email,password,email_verified_at)
    VALUES('anon_unsubscribe_test',?,'!',CURRENT_TIMESTAMP) RETURNING id`).get(email) as { id: number }
  const session = 'unfinished-unsubscribe-session'
  const now = Date.now()
  insertSession(database, session, user.id, now + SESSION_LIFETIME_MS, now, 'Integration test')
  const cookie = `textlog=${session}`

  const recapToken = issueRecapUnsubscribeToken(database, user.id)
  const recap = await request(`/account/recap-emails/unsubscribe?token=${encodeURIComponent(recapToken)}`, {
    cookie,
    acceptHtml: true,
  })
  expect(recap.status).toBe(200)
  expect(await recap.text()).toContain('You have been unsubscribed.')

  const interactedToken = issueInteractedUnsubscribeToken(database, user.id)
  const interacted = await request(
    `/account/interacted-emails/unsubscribe?token=${encodeURIComponent(interactedToken)}`,
    { method: 'POST', cookie },
  )
  expect(interacted.status).toBe(200)
  expect(await interacted.text()).toBe('Unsubscribed')
})

test('internal identity headers cannot be supplied by clients', async () => {
  const forged = Buffer.from(JSON.stringify({ id: 1, handle: 'admin', email: 'admin@example.test', bio: '' }))
    .toString('base64url')
  const response = await fetch(`${origin}/api/v1/me`, {
    headers: { authorization: 'Bearer invalid', 'x-textlog-api-user': forged },
  })
  expect(response.status).toBe(401)
})

test('stats are public without exposing admin operations', async () => {
  const response = await request('/stats')
  expect(response.status).toBe(200)
  expect(response.headers.get('x-robots-tag')).toBeNull()
  expect(response.headers.get('link')).toContain(`${origin}/stats`)

  const html = await response.text()
  expect(html).toContain('<div class="account-settings-heading admin-header">')
  expect(html).toContain('<p class="eyebrow">community</p>')
  expect(html).toContain('<h1>stats</h1>')
  expect(html).not.toContain('<p class="eyebrow">textlog</p>')
  expect(html).toContain('aria-label="Application statistics"')
  expect(html).toContain('<span>users</span>')
  expect(html).toContain('<span>median/avg notes per user</span>')
  expect(html).toContain('<span>active users · 24h</span>')
  expect(html).toContain('<span>active users · 1mo</span>')
  expect(html).toMatch(/<strong>[\d.,]+%<\/strong><span>Conversion rate · yesterday<\/span>/)
  expect(html).toMatch(/<strong>[\d.,]+%<\/strong><span>Signup-to-active conversion · yesterday<\/span>/)
  expect(html).not.toContain('<span>suspended</span>')
  expect(html).not.toContain('<span>users online · 30m</span>')
  expect(html).not.toContain('<span>anonymous online · 30m</span>')
  expect(html).not.toContain('admin dashboard')
  expect(html).not.toContain('illegal activity reports')
  expect(html).not.toContain('recent admin actions')
})

test('notification banners are hidden from logged-out visitors', async () => {
  const home = await request('/')
  expect(home.status).toBe(303)
  expect(home.headers.get('location')).toBe('/hot')
  for (const path of ['/hot', '/new', '/all']) {
    const response = await request(path)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('class="notification-banner"')
    expect(html).not.toContain('support us on open collective')
    expect(html).not.toContain('enable notifications')
    expect(html).not.toContain('customize appearance')
  }
})

test('new feed first page participates in materialized caching', async () => {
  const first = await request('/new')
  expect(first.status).toBe(200)
  expect(['miss', 'durable']).toContain(first.headers.get('x-feed-cache'))

  const second = await request('/new')
  expect(second.status).toBe(200)
  expect(second.headers.get('x-feed-cache')).toBe('durable')
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

test('signed-in users can invite a deduplicated list of friends with join magic links', async () => {
  const cookie = await signup('inviter', 'inviter@example.com', 'unused', 'invite-signup')
  const invitePage = await request('/account/edit/invite', { cookie })
  expect(invitePage.status).toBe(200)
  const inviter = database.query('SELECT id FROM users WHERE handle=?').get('inviter') as { id: number }
  expect(database.query('SELECT 1 FROM invite_banner_dismissals WHERE user_id=?').get(inviter.id)).toBeDefined()
  const inviteHtml = await invitePage.text()
  expect(inviteHtml).toContain('<p class="eyebrow">share textlog</p>')
  expect(inviteHtml).toContain('<h2 class="panel-heading">Bring your friends along</h2>')
  expect(inviteHtml).not.toContain('account settings')
  expect(inviteHtml).toContain('class="secondary-action cancel-action"')
  expect(inviteHtml).not.toContain('>back</a>')
  expect(inviteHtml).toContain('Your friends will get a magic link to join textlog.')
  expect(inviteHtml).toContain('name="emails"')

  const invited = await request('/account/edit/invite', {
    method: 'POST',
    cookie,
    form: { emails: 'First.Invite@example.com, second-invite@example.com first.invite@example.com' },
  })
  expect(invited.status).toBe(200)
  expect(await invited.text()).toContain('2 invitations sent.')

  const firstMessages = capturedEmails().filter(item => item.to === 'first.invite@example.com')
  const secondMessages = capturedEmails().filter(item => item.to === 'second-invite@example.com')
  expect(firstMessages).toHaveLength(1)
  expect(secondMessages).toHaveLength(1)
  expect(firstMessages[0]?.subject).toBe('You\'ve been invited to textlog')
  expect(firstMessages[0]?.text).toContain('Your friend @inviter has invited you to join textlog.')
  expect(firstMessages[0]?.text).toContain('Click on this magic link to join')
  const invitationExpiry = database.query('SELECT expires_at,created_at FROM magic_links WHERE email=?')
    .get('first.invite@example.com') as { expires_at: number; created_at: number }
  expect(invitationExpiry.expires_at - invitationExpiry.created_at).toBe(7 * 24 * 60 * 60 * 1000)

  const joined = await request(`/enter/magic?token=${encodeURIComponent(linkToken(firstMessages[0]!))}`)
  expect(joined.status).toBe(303)
  expect(joined.headers.get('location')).toBe('/choose-handle?next=%2Fexplore')
  const handleScreen = await request(joined.headers.get('location')!, {
    cookie: sessionCookie(joined),
    acceptHtml: true,
  })
  const handleHtml = await handleScreen.text()
  expect(handleHtml).toContain('action="/choose-handle"')
  expect(handleHtml).not.toContain('action="/pick-mood"')
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

  database.query('UPDATE users SET password=\'password-enabled\' WHERE id IN (?,?)').run(primary.id, bot.id)
  const beforeHandleResets = capturedEmails().length
  for (const handle of ['persona_primary', '@persona_bot']) {
    const response = await request('/forgot-password', {
      method: 'POST',
      form: { identifier: handle },
      ip: `password-reset-${handle}`,
    })
    expect(response.status).toBe(200)
  }
  const handleResetEmails = capturedEmails().slice(beforeHandleResets)
  expect(handleResetEmails).toHaveLength(2)
  expect(handleResetEmails.every(message => message.to === email && message.subject.includes('Reset your'))).toBe(true)

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
  const guestHot = await (await request('/hot')).text()
  expect(guestHot).not.toContain('href="/donation/banner/accept"')
  expect(guestHot).not.toContain('❤️ support us on open collective')
  expect(guestHot).not.toContain('will donate later')
  const guestDonationAcceptance = await request('/donation/banner/accept')
  expect(guestDonationAcceptance.status).toBe(303)
  expect(guestDonationAcceptance.headers.get('location')).toBe('https://opencollective.com/textlog')
  const guestDonationCookie = guestDonationAcceptance.headers.get('set-cookie')
    ?.match(/donation_banner_dismissed=1/)?.[0]
  expect(guestDonationCookie).toBeDefined()
  expect(await (await request('/hot', { cookie: guestDonationCookie })).text())
    .not.toContain('support us on open collective')

  let aliceCookie = await signup('alice', 'alice@example.com', 'unused')
  const alice = database.query('SELECT id,email_verified_at FROM users WHERE handle=?')
    .get('alice') as { id: number; email_verified_at: string | null }
  expect(alice.email_verified_at).not.toBeNull()
  const authenticatedEntry = await request('/enter', { cookie: aliceCookie })
  expect(authenticatedEntry.status).toBe(303)
  expect(authenticatedEntry.headers.get('location')).toBe('/')
  const emailCount = capturedEmails().length
  const otherAccountRequest = await request('/enter', {
    method: 'POST',
    cookie: aliceCookie,
    form: { email: 'another-account@example.com' },
  })
  expect(otherAccountRequest.status).toBe(303)
  expect(otherAccountRequest.headers.get('location')).toBe('/')
  expect(capturedEmails()).toHaveLength(emailCount)

  const foreignRequest = await request('/enter', {
    method: 'POST',
    form: { email: 'foreign-account@example.com' },
    ip: 'foreign-account-request',
  })
  expect(foreignRequest.status).toBe(200)
  const foreignEmail = capturedEmails().filter(message => message.to === 'foreign-account@example.com').at(-1)!
  const foreignEntry = await request(`/enter/magic?token=${encodeURIComponent(linkToken(foreignEmail))}`, {
    cookie: aliceCookie,
  })
  expect(foreignEntry.status).toBe(400)

  const ownLinkRequest = await request('/enter', {
    method: 'POST',
    cookie: aliceCookie,
    form: { identifier: 'alice' },
    ip: 'alice-own-link',
  })
  expect(ownLinkRequest.status).toBe(200)
  const ownEmail = capturedEmails().filter(message => message.to === 'alice@example.com').at(-1)!
  const ownEntry = await request(`/enter/magic?token=${encodeURIComponent(linkToken(ownEmail))}`, {
    cookie: aliceCookie,
  })
  expect(ownEntry.status).toBe(303)
  const ownLinkCookie = sessionCookie(ownEntry)
  expect((await request('/logout', { method: 'POST', cookie: ownLinkCookie, form: {} })).status).toBe(303)
  const authenticatedHome = await request('/', { cookie: aliceCookie })
  expect(authenticatedHome.status).toBe(303)
  expect(authenticatedHome.headers.get('location')).toBe('/my-feed')
  const authenticatedHomeHtml = await (await request(authenticatedHome.headers.get('location')!, {
    cookie: aliceCookie,
  })).text()
  expect(authenticatedHomeHtml).toContain('class="account-nav"')
  expect(authenticatedHomeHtml).toContain('@alice')
  expect(authenticatedHomeHtml).toContain('href="/account/edit?from=%2Fmy-feed">account</a>')
  expect(authenticatedHomeHtml).not.toContain('href="/login">login</a>')
  expect(authenticatedHomeHtml).toContain('class="notification-banner"')
  const accountFromLatest = await request('/account/edit?from=%2Flatest%3Fpage%3D2', { cookie: aliceCookie })
  const accountFromLatestHtml = await accountFromLatest.text()
  expect(accountFromLatestHtml).toContain('href="/latest?page=2">back</a>')
  expect(accountFromLatestHtml).toContain('id="recap-emails"')
  expect(accountFromLatestHtml).toContain('href="/account/recap-emails">manage recap emails</a>')
  const recapToken = issueRecapUnsubscribeToken(database, alice.id)
  const unsubscribedRecaps = await request(
    '/account/recap-emails/unsubscribe?token=' + encodeURIComponent(recapToken),
  )
  expect(unsubscribedRecaps.status).toBe(200)
  expect(await unsubscribedRecaps.text()).toContain('You have been unsubscribed.')
  expect(database.query('SELECT recap_emails FROM users WHERE id=?').get(alice.id)).toEqual({ recap_emails: 0 })
  const recapSettings = await (await request('/account/recap-emails', { cookie: aliceCookie })).text()
  expect(recapSettings).toContain('name="subscribed" value="1"')
  expect(recapSettings).toContain('>subscribe</button>')
  expect(accountFromLatestHtml).toContain('id="interaction-emails"')
  expect(accountFromLatestHtml).toContain('href="/account/interacted-emails"')
  const interactedToken = issueInteractedUnsubscribeToken(database, alice.id)
  const unsubscribedInteractions = await request(
    '/account/interacted-emails/unsubscribe?token=' + encodeURIComponent(interactedToken),
  )
  expect(unsubscribedInteractions.status).toBe(200)
  expect(await unsubscribedInteractions.text()).toContain('You have been unsubscribed.')
  expect(database.query('SELECT interaction_emails FROM users WHERE id=?').get(alice.id))
    .toEqual({ interaction_emails: 0 })
  const interactedSettings = await (await request('/account/interacted-emails', { cookie: aliceCookie })).text()
  expect(interactedSettings).toContain('name="subscribed" value="1"')
  expect(interactedSettings).toContain('>subscribe</button>')
  const rememberedActivity = await request('/activity', { cookie: aliceCookie })
  expect(rememberedActivity.status).toBe(303)
  expect(rememberedActivity.headers.get('location')).toBe('/@')
  const activityHome = await request('/', { cookie: `${aliceCookie}; feed=activity` })
  expect(activityHome.status).toBe(303)
  expect(activityHome.headers.get('location')).toBe('/@')
  const atFeed = await request('/@', { cookie: aliceCookie })
  expect(atFeed.headers.get('set-cookie')).toContain('feed=activity')
  const latestHome = await request('/?page=2', { cookie: `${aliceCookie}; feed=latest` })
  expect(latestHome.status).toBe(303)
  expect(latestHome.headers.get('location')).toBe('/all?page=2')
  const hotHome = await request('/', { cookie: `${aliceCookie}; feed=hot` })
  expect(hotHome.status).toBe(303)
  expect(hotHome.headers.get('location')).toBe('/hot')
  const activityHomeHtml = await (await request('/my-feed', { cookie: `${aliceCookie}; feed=activity` })).text()
  expect(activityHomeHtml).toContain(
    'class="active" aria-current="page" href="/my-feed"',
  )
  expect(activityHomeHtml).toContain('<title>my feed · textlog</title>')
  for (const path of ['/my-feed', '/hot', '/all']) {
    expect(await (await request(path, { cookie: aliceCookie })).text()).toContain('class="notification-banner"')
  }
  const notificationSettings = await request('/account/edit/notifications', { cookie: aliceCookie })
  expect(notificationSettings.status).toBe(200)
  expect(await notificationSettings.text()).toContain('name="latest" checked=""')
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
  const enabledDeviceHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-browser',
  })).text()
  expect(enabledDeviceHome).toContain('class="notification-banner"')
  expect(enabledDeviceHome).not.toContain('check the improved notifications')
  expect(enabledDeviceHome).toContain('href="/account/edit/appearance">customize appearance</a>')
  const disabledEndpoint = 'https://push.example/alice-disabled-browser'
  expect((await request('/account/push-subscription', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-disabled-browser',
    json: { endpoint: disabledEndpoint, keys: { p256dh: 'test-key', auth: 'test-auth' } },
  })).status).toBe(200)
  const disabledPush = await request('/account/push-subscription', {
    method: 'DELETE',
    cookie: aliceCookie,
    userAgent: 'alice-disabled-browser',
    json: { endpoint: disabledEndpoint },
  })
  expect(disabledPush.status).toBe(200)
  expect(database.query(`SELECT status FROM notification_user_agents WHERE user_id=? AND user_agent=?`)
    .get(alice.id, 'alice-disabled-browser')).toEqual({ status: 'dismissed' })
  const disabledDeviceHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-disabled-browser',
  })).text()
  expect(disabledDeviceHome).not.toContain('href="/account/edit/notifications">enable notifications</a>')
  expect(disabledDeviceHome).toContain('href="/account/edit/appearance">customize appearance</a>')
  const otherBrowserHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-other-browser',
  })).text()
  expect(otherBrowserHome).toContain('class="notification-banner"')
  expect(otherBrowserHome).not.toContain('check the improved notifications')
  database.query(`INSERT INTO notification_user_agents(user_id,user_agent,status) VALUES(?,?,'enabled')`)
    .run(alice.id, 'alice-improvements-browser')
  const improvementsHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-improvements-browser',
  })).text()
  expect(improvementsHome).toContain('href="/account/edit/notifications">check the improved notifications</a>')
  const dismissedImprovements = await request('/notifications/improvements/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-improvements-browser',
  })
  expect(dismissedImprovements.status).toBe(303)
  const improvementDismissedHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-improvements-browser',
  })).text()
  expect(improvementDismissedHome).not.toContain('check the improved notifications')
  expect(improvementDismissedHome).toContain('href="/account/edit/appearance">customize appearance</a>')
  const legacyDismissedHome = await (await request('/my-feed', {
    cookie: `${aliceCookie}; notification_banner_dismissed=${alice.id}`,
    userAgent: 'alice-legacy-browser',
  })).text()
  expect(legacyDismissedHome).toContain('href="/account/edit/appearance">customize appearance</a>')

  const dismissed = await request('/notifications/banner/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(dismissed.status).toBe(303)
  expect(dismissed.headers.get('set-cookie')).toBeNull()
  const dismissedHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(dismissedHome).toContain('href="/account/edit/appearance">customize appearance</a>')
  const dismissedAppearance = await request('/appearance/banner/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(dismissedAppearance.status).toBe(303)
  const dismissedBio = await request('/bio/banner/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(dismissedBio.status).toBe(303)
  expect(database.query('SELECT 1 FROM bio_banner_dismissals WHERE user_id=?').get(alice.id)).toBeDefined()
  const fullyDismissedHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(fullyDismissedHome).toContain('href="/account/edit/invite">invite friends</a>')
  const dismissedInvite = await request('/invite/banner/dismiss', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(dismissedInvite.status).toBe(303)
  database.query('DELETE FROM bio_banner_dismissals WHERE user_id=?').run(alice.id)
  const setupDismissedHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(setupDismissedHome).toContain('href="/bio/banner/accept">edit your bio</a>')
  const openedBioEditor = await request('/bio/banner/accept', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(openedBioEditor.status).toBe(303)
  expect(openedBioEditor.headers.get('location')).toBe('/account/edit')
  expect(database.query('SELECT 1 FROM bio_banner_dismissals WHERE user_id=?').get(alice.id)).toBeDefined()
  const bioHandledHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(bioHandledHome).toContain('support us on open collective')
  const acceptedDonation = await request('/donation/banner/accept', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })
  expect(acceptedDonation.status).toBe(303)
  expect(acceptedDonation.headers.get('location')).toBe('https://opencollective.com/textlog')
  expect(acceptedDonation.headers.get('set-cookie')).toBeNull()
  expect(database.query('SELECT 1 FROM donation_banner_dismissals WHERE user_id=?').get(alice.id)).toBeDefined()
  const donationDismissedHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-dismissed-browser',
  })).text()
  expect(donationDismissedHome).not.toContain('class="notification-banner"')
  const openedAppearance = await request('/account/edit/appearance', {
    cookie: aliceCookie,
    userAgent: 'alice-browser',
  })
  expect(openedAppearance.status).toBe(200)
  const merelyOpenedDeviceHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-browser',
  })).text()
  expect(merelyOpenedDeviceHome).toContain('href="/account/edit/appearance">customize appearance</a>')
  const savedAppearance = await request('/account/edit/appearance', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-browser',
    form: { tab: 'theme', theme: 'system', accent: 'theme' },
  })
  expect(savedAppearance.status).toBe(303)
  const disabledLinkPreviews = await request('/account/edit/appearance', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-browser',
    form: { tab: 'misc', pageSize: '20', density: 'regular' },
  })
  expect(disabledLinkPreviews.status).toBe(303)
  expect(database.query('SELECT show_link_previews FROM users WHERE id=?').get(alice.id))
    .toEqual({ show_link_previews: 0 })
  const linkPreviewsDisabledHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-other-browser',
  })).text()
  expect(linkPreviewsDisabledHome)
    .toContain('<body class="density-regular link-previews-disabled has-mobile-write-action">')
  const linkPreviewSettings = await (await request('/account/edit/appearance?tab=misc', {
    cookie: aliceCookie,
    userAgent: 'alice-other-browser',
  })).text()
  expect(linkPreviewSettings).toContain('name="showLinkPreviews" value="yes"')
  expect(linkPreviewSettings).not.toContain('name="showLinkPreviews" checked=""')
  expect(linkPreviewSettings).not.toContain('name="showModeratedContent" checked=""')
  const enabledModeratedContent = await request('/account/edit/appearance', {
    method: 'POST',
    cookie: aliceCookie,
    userAgent: 'alice-browser',
    form: { tab: 'misc', pageSize: '20', density: 'regular', showModeratedContent: 'yes' },
  })
  expect(enabledModeratedContent.status).toBe(303)
  expect(database.query('SELECT show_moderated_content FROM users WHERE id=?').get(alice.id))
    .toEqual({ show_moderated_content: 1 })
  const moderatedContentSettings = await (await request('/account/edit/appearance?tab=misc', {
    cookie: aliceCookie,
    userAgent: 'alice-browser',
  })).text()
  expect(moderatedContentSettings).toContain('name="showModeratedContent" checked="" value="yes"')
  const configuredDeviceHome = await (await request('/my-feed', {
    cookie: aliceCookie,
    userAgent: 'alice-browser',
  })).text()
  expect(configuredDeviceHome).not.toContain('class="notification-banner"')
  const pushPreferences = await request(
    '/account/push-subscription?endpoint=' + encodeURIComponent(endpoint),
    { cookie: aliceCookie },
  )
  expect(await pushPreferences.json()).toEqual({
    enabled: true,
    preferences: { latest: 0, replies: 1, mentions: 0, follows: 1, followActivity: 1, followingNotes: 1,
      followingOnlyToMe: 0, broadcasts: 1, peopleFollowActivity: 0, hashtagFollowActivity: 0 },
  })
  const cacheBustedHome = await request('/?v=94721')
  expect(cacheBustedHome.status).toBe(303)
  expect(cacheBustedHome.headers.get('location')).toBe('/hot?v=94721')
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
  expect(noteSearchHtml).toContain('href="/enter?next=%2Fsearch%3Fq%3Dhello"')
  const tagSearchHtml = await (await request('/search?q=hello&tab=tags')).text()
  expect(tagSearchHtml).toContain('placeholder="search tags"')
  const peopleSearchHtml = await (await request('/search?q=hello&tab=people')).text()
  expect(peopleSearchHtml).toContain('placeholder="search people"')
  const welcomeCookie = `${aliceCookie}; explore_welcome=1`
  const welcomeExplore = await request('/explore', { cookie: welcomeCookie })
  const welcomeExploreHtml = await welcomeExplore.text()
  expect(welcomeExploreHtml).toContain('href="/u/alice?from=%2Fexplore">profile</a>')
  expect(welcomeExploreHtml).not.toContain('action="/search"')
  expect(welcomeExploreHtml).toContain('action="/explore/welcome/dismiss"')
  expect(welcomeExploreHtml).toContain('aria-label="Dismiss welcome"')
  expect(welcomeExploreHtml).toContain('href="/account/edit/notifications">enable notifications</a>')
  expect(welcomeExploreHtml).toContain('href="/account/edit/appearance">customize appearance</a>')
  expect(welcomeExploreHtml).toContain('href="/account/edit/invite">invite friends</a>')
  expect(welcomeExploreHtml).toContain('href="/account/password/enable">set up a password</a>')
  const dismissedWelcome = await request('/explore/welcome/dismiss', { method: 'POST', cookie: welcomeCookie })
  expect(dismissedWelcome.status).toBe(303)
  expect(dismissedWelcome.headers.get('location')).toBe('/explore')
  expect(dismissedWelcome.headers.get('set-cookie')).toContain('explore_welcome=; Max-Age=0')
  const publicProfile = await request('/u/alice', { cookie: aliceCookie })
  expect(publicProfile.status).toBe(200)
  const followBadge = await request('/u/alice/follow.png')
  expect(followBadge.status).toBe(200)
  expect(followBadge.headers.get('content-type')).toContain('image/png')
  expect(followBadge.headers.get('cache-control')).toBe('public, max-age=3600, must-revalidate')
  expect(followBadge.headers.get('access-control-allow-origin')).toBe('*')
  expect(followBadge.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
  const followBadgeBytes = await followBadge.arrayBuffer()
  expect(new Uint8Array(followBadgeBytes).slice(0, 8))
    .toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  const draculaFollowBadge = await request('/u/alice/follow.png?theme=dracula')
  expect(draculaFollowBadge.status).toBe(200)
  expect(draculaFollowBadge.headers.get('content-type')).toContain('image/png')
  expect(await draculaFollowBadge.arrayBuffer()).not.toEqual(followBadgeBytes)
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

  const logout = await request('/logout', {
    method: 'POST',
    cookie: aliceCookie,
    form: { returnTo: '/tag/onboarding?page=2' },
  })
  expect(logout.status).toBe(303)
  expect(logout.headers.get('location')).toBe('/tag/onboarding?page=2')
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

  const savedNoteDraft = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A saved note draft', action: 'draft', from: '/latest' },
  })
  expect(savedNoteDraft.status).toBe(303)
  expect(savedNoteDraft.headers.get('location')).toBe('/drafts?from=%2Flatest')
  const noteDraft = database.query('SELECT id,public_id,body,parent_id FROM drafts WHERE user_id=?').get(alice.id) as {
    id: number
    public_id: string
    body: string
    parent_id: number | null
  }
  expect(noteDraft.parent_id).toBeNull()
  const draftsPageHtml = await (await request('/drafts?from=%2Flatest', { cookie: aliceCookie })).text()
  expect(draftsPageHtml).toContain('A saved note draft')
  expect(draftsPageHtml).toContain('href="/latest">back</a>')
  expect(draftsPageHtml).toContain(`/drafts/${noteDraft.public_id}/edit?from=%2Flatest`)
  const draftEditHtml = await (await request(`/drafts/${noteDraft.public_id}/edit?from=%2Flatest`, {
    cookie: aliceCookie,
  })).text()
  expect(draftEditHtml).toContain('A saved note draft')
  expect(draftEditHtml).toContain(`name="draft_id" value="${noteDraft.public_id}"`)
  expect(draftEditHtml).toContain(`formAction="/drafts/${noteDraft.public_id}"`)
  const previewedDraft = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'The previewed note draft', action: 'preview', draft_id: noteDraft.public_id, from: '/latest' },
  })
  expect(previewedDraft.status).toBe(200)
  expect(await previewedDraft.text()).toContain(`name="draft_id" value="${noteDraft.public_id}"`)
  expect((database.query('SELECT count(*) count FROM drafts WHERE user_id=?').get(alice.id) as { count: number })
    .count).toBe(1)
  expect((database.query('SELECT body FROM drafts WHERE id=?').get(noteDraft.id) as { body: string }).body)
    .toBe('The previewed note draft')
  const overwrittenDraft = await request(`/drafts/${noteDraft.public_id}`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'The overwritten note draft', action: 'draft' },
  })
  expect(overwrittenDraft.status).toBe(303)
  expect((database.query('SELECT count(*) count FROM drafts WHERE user_id=?').get(alice.id) as { count: number })
    .count).toBe(1)
  expect((database.query('SELECT body FROM drafts WHERE id=?').get(noteDraft.id) as { body: string }).body)
    .toBe('The overwritten note draft')
  const confirmDraftDeleteHtml = await (await request(`/drafts/${noteDraft.public_id}/delete?from=%2Flatest`, {
    cookie: aliceCookie,
  })).text()
  expect(confirmDraftDeleteHtml).toContain('Delete this draft?')
  expect(confirmDraftDeleteHtml).toContain('The overwritten note draft')
  expect(confirmDraftDeleteHtml).toContain('href="/drafts?from=%2Flatest">cancel</a>')
  const deletedDraft = await request(`/drafts/${noteDraft.public_id}/delete`, { method: 'POST', cookie: aliceCookie,
    form: {} })
  expect(deletedDraft.status).toBe(303)
  expect(database.query('SELECT 1 FROM drafts WHERE id=?').get(noteDraft.id)).toBeNull()

  const createPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A route-level integration post', from: '/all' },
  })
  expect(createPost.status).toBe(303)
  const post = database.query('SELECT id,body FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1')
    .get(alice.id) as { id: number; body: string }
  expect(createPost.headers.get('location')).toBe('/all')

  const unpublishable = database.query(
    'INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,NULL,?,datetime(\'now\')) RETURNING id',
  ).get(alice.id, 'Published text before editing') as { id: number }
  const unpublished = await request(`/post/${unpublishable.id}/edit`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'Text preserved in the draft', action: 'unpublish' },
  })
  expect(unpublished.status).toBe(303)
  const unpublishedDraft = database.query('SELECT id,body,parent_id FROM drafts WHERE user_id=? AND body=?')
    .get(alice.id, 'Text preserved in the draft') as { id: number; body: string; parent_id: number | null }
  expect(unpublished.headers.get('location')).toBe('/drafts')
  expect(unpublishedDraft.parent_id).toBeNull()
  expect(database.query('SELECT deleted_at FROM posts WHERE id=?').get(unpublishable.id))
    .toMatchObject({ deleted_at: expect.any(String) })

  const savedReplyDraft = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A saved reply draft', action: 'draft' },
  })
  expect(savedReplyDraft.status).toBe(303)
  expect(savedReplyDraft.headers.get('location')).toBe(`/drafts?from=${encodeURIComponent(`/post/${post.id}`)}`)
  const replyDraft = database.query('SELECT id,public_id,parent_id FROM drafts WHERE user_id=?').get(alice.id) as {
    id: number
    public_id: string
    parent_id: number
  }
  expect(replyDraft.parent_id).toBe(post.id)
  const replyDraftEditHtml = await (await request(`/drafts/${replyDraft.public_id}/edit`, { cookie: aliceCookie })).text()
  expect(replyDraftEditHtml).toContain('A saved reply draft')
  expect(replyDraftEditHtml).toContain(`action="/post/${post.id}/reply#post-${post.id}"`)
  const publishedReplyDraft = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'Published reply draft', draft_id: replyDraft.public_id },
  })
  expect(publishedReplyDraft.status).toBe(303)
  expect(database.query('SELECT 1 FROM drafts WHERE id=?').get(replyDraft.id)).toBeNull()

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
  const invalidPostBody = `remember post ${'x'.repeat(490)}`
  const invalidPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: invalidPostBody },
  })
  expect(invalidPost.status).toBe(400)
  expect(await invalidPost.text()).toContain(invalidPostBody)
  const invalidEmbeddedPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: '', embedded: '1', from: '/all' },
  })
  expect(invalidEmbeddedPost.status).toBe(303)
  const embeddedErrorLocation = invalidEmbeddedPost.headers.get('location')!
  expect(embeddedErrorLocation).toStartWith('/all?write_error=')
  const embeddedErrorHtml = await (await request(embeddedErrorLocation, { cookie: aliceCookie })).text()
  expect(embeddedErrorHtml).toContain('class="panel panel-surface panel-medium compose write-compose embedded-write-compose"')
  expect(embeddedErrorHtml).toContain('The note must contain between 1 and 500 characters.')
  expect(embeddedErrorHtml).not.toContain('<title>write ·')
  const invalidReplyBody = `remember reply ${'x'.repeat(490)}`
  const invalidReply = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: invalidReplyBody },
  })
  expect(invalidReply.status).toBe(400)
  expect(await invalidReply.text()).toContain(invalidReplyBody)
  const quotedReply = database.query(
    'INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,?,?,datetime(\'now\')) RETURNING id',
  ).get(alice.id, post.id, 'A reply quoting the original post') as { id: number }
  const replyPreview = await request(`/post/${quotedReply.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A nested reply preview', action: 'preview' },
  })
  expect(replyPreview.status).toBe(200)
  const replyPreviewHtml = await replyPreview.text()
  expect(replyPreviewHtml).toContain('A nested reply preview')
  const previewedReplyDraft = database.query('SELECT id,public_id,body,parent_id FROM drafts WHERE user_id=? AND body=?')
    .get(alice.id, 'A nested reply preview') as { id: number; public_id: string; body: string; parent_id: number }
  expect(previewedReplyDraft.parent_id).toBe(quotedReply.id)
  expect(replyPreviewHtml).toContain(`name="draft_id" value="${previewedReplyDraft.public_id}"`)
  const updatedReplyPreview = await request(`/post/${quotedReply.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'An updated nested reply preview', action: 'preview', draft_id: previewedReplyDraft.public_id },
  })
  expect(updatedReplyPreview.status).toBe(200)
  expect((database.query('SELECT body FROM drafts WHERE id=?').get(previewedReplyDraft.id) as { body: string }).body)
    .toBe('An updated nested reply preview')
  expect(replyPreviewHtml).toContain(`id="post-${quotedReply.id}"`)
  expect(replyPreviewHtml).toContain(`action="/post/${quotedReply.id}/reply#post-${quotedReply.id}"`)
  expect(replyPreviewHtml).toContain('A route-level integration post')
  const invalidEditBody = `remember edit ${'x'.repeat(490)}`
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
  const invalidMood = await request('/account/edit', {
    method: 'POST',
    cookie: aliceCookie,
    form: { handle: 'Alice', mood: 'hi', bio: 'remember profile bio' },
  })
  expect(invalidMood.status).toBe(400)
  const invalidMoodHtml = await invalidMood.text()
  expect(invalidMoodHtml).toContain('Mood should be an emoji.')
  expect(invalidMoodHtml).toContain('name="mood" value="hi"')
  database.query("UPDATE users SET mood='🤸' WHERE handle='alice'").run()
  const moodSettingsHtml = await (await request('/account/edit', { cookie: aliceCookie })).text()
  expect(moodSettingsHtml).toContain('name="mood" value="🤸"')
  const multilineBio = Array(11).fill('bio line').join('\n')
  const invalidMultilineBio = await request('/account/edit', {
    method: 'POST',
    cookie: aliceCookie,
    form: { handle: 'Alice', bio: multilineBio },
  })
  expect(invalidMultilineBio.status).toBe(400)
  const invalidMultilineBioHtml = await invalidMultilineBio.text()
  expect(invalidMultilineBioHtml).toContain('The bio exceeds the limit: 11/10 lines.')
  expect(invalidMultilineBioHtml).toContain(multilineBio)
  const search = await request('/search?q=route-level', { cookie: aliceCookie })
  expect(search.status).toBe(200)
  expect(search.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  const searchHtml = await search.text()
  expect(searchHtml).toContain('>1 notes</a>')
  expect(searchHtml).toContain('>0 tags</a>')
  expect(searchHtml).toContain('>0 people</a>')
  expect(searchHtml).toContain('A <mark>route</mark>-<mark>level</mark> integration post')
  expect(searchHtml).not.toContain('>read</a>')
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
  expect(hashtagHelperHtml).toContain('id="write-posting-help" type="checkbox"')
  expect(hashtagHelperHtml).toContain('aria-controls="write-posting-help-content" checked=""')
  const mentionHelper = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: '', action: 'search-mentions', mention_query: '@ali' },
  })
  expect(mentionHelper.status).toBe(200)
  const mentionHelperHtml = await mentionHelper.text()
  expect(mentionHelperHtml).toContain('@<mark>ali</mark>ce')
  expect(mentionHelperHtml).toContain('name="mention_query" value="ali"')
  expect(mentionHelperHtml).toContain('name="body" maxLength="500" autofocus=""')
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
  const crawledFeed = await request('/all', { userAgent: 'Googlebot/2.1' })
  const crawledFeedHtml = await crawledFeed.text()
  expect(crawledFeedHtml).not.toContain('from=')
  expect(crawledFeedHtml).not.toContain('from%3D')
  expect(crawledFeed.headers.get('vary')).toContain('User-Agent')
  const privatePost = await request(`/post/${post.id}`, { cookie: aliceCookie })
  expect(privatePost.headers.get('cache-control')).toBe('private, no-store')
  const privateReplyForm = await request(`/post/${post.id}?reply=1`, { cookie: aliceCookie })
  expect(privateReplyForm.headers.get('cache-control')).toBe('private, no-store')
  const smallReplyHtml = await (await request(`/post/${post.id}?reply=1`, {
    cookie: `${aliceCookie}; appearance=light.sage; font-size=small`,
  })).text()
  const largerReplyHtml = await (await request(`/post/${post.id}?reply=1`, {
    cookie: `${aliceCookie}; appearance=dracula.pink; font-size=larger`,
  })).text()
  expect(smallReplyHtml).toContain('--bg:#f4f3ee')
  expect(smallReplyHtml).toContain('font-size:14px')
  expect(largerReplyHtml).toContain('--bg:#282a36')
  expect(largerReplyHtml).toContain('font-size:20px')
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
  for (let index = 1; index <= 201; index++) insertFeedPost.run(alice.id, `cursor note ${index}`)
  const latestFirst = await request('/all')
  const latestFirstBody = await latestFirst.text()
  const latestNext = latestFirstBody.match(/href="(\/all\?page=2)"/)?.[1]
  expect(latestNext).toBeTruthy()
  expect(latestFirstBody).toContain('cursor note 102')
  expect(latestFirstBody).not.toContain(post.body)
  const latestSecondBody = await (await request('/all?page=2')).text()
  expect(latestSecondBody).not.toContain(post.body)
  expect(latestSecondBody).toContain('← prev')
  expect(await (await request('/all?page=3')).text()).toContain(post.body)

  const forYouFirstBody = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(forYouFirstBody).not.toContain('/my-feed?cursor=')
  expect(forYouFirstBody).not.toContain('cursor note 81')
  expect(forYouFirstBody).toContain(post.body)
  expect(forYouFirstBody).not.toContain('action="/my-feed/read-all"')
  expect(forYouFirstBody).not.toContain('class="for-you-item activity-item-unread"')

  const profileFirstBody = await (await request('/u/alice')).text()
  const profileNext = profileFirstBody.match(/href="(\/u\/alice\?page=2)"/)?.[1]
  expect(profileNext).toBeTruthy()
  expect(profileFirstBody).not.toContain(post.body)
  expect(await (await request('/u/alice?page=2')).text()).not.toContain(post.body)
  expect(await (await request('/u/alice?page=3')).text()).toContain(post.body)
  expect((await request('/all?cursor=broken')).status).toBe(400)
  expect((await request('/my-feed?cursor=broken', { cookie: aliceCookie })).status).toBe(400)
  expect((await request('/activity?cursor=broken', { cookie: aliceCookie })).status).toBe(303)
  const invalidHomeCursor = await request('/?cursor=broken', { cookie: aliceCookie })
  expect(invalidHomeCursor.status).toBe(303)
  expect(invalidHomeCursor.headers.get('location')).toBe('/my-feed?cursor=broken')
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
  const followedPersonFeed = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(followedPersonFeed).not.toContain('Bob builds things')
  expect(followedPersonFeed).toContain('href="/my-feed">')
  expect(followedPersonFeed).toContain(
    'href="/@">@<span class="to-me-count">1</span></a>',
  )
  const followedPersonToMe = await (await request('/@', { cookie: aliceCookie })).text()
  expect(followedPersonToMe).toContain('<a class="reference-menu-trigger postauthor" '
    + 'href="/u/bob?from=%2F%40%23a-')
  expect(followedPersonToMe).not.toContain('reference-profile-tabs')
  expect(followedPersonToMe).toContain('<p class="profile-bio">Bob builds things</p>')
  expect(followedPersonToMe).toContain('<form action="/follow/bob" method="post">'
    + '<input type="hidden" name="from" value="/@#a-')
  expect(followedPersonToMe).toContain('<button class="button button-muted">unfollow</button>')
  expect(followedPersonToMe).not.toContain('action="/follow/alice"')
  expect(followedPersonToMe).toContain('activity-follow activity-item-directed-unread')
  expect(followedPersonToMe).toContain('class="unread-dot" aria-label="unread"')
  const revisitedToMe = await (await request('/@', { cookie: aliceCookie })).text()
  expect(revisitedToMe).not.toContain('class="unread-dot" aria-label="unread"')
  expect(revisitedToMe).not.toContain('activity-item-directed-unread')
  const updateBob = await request('/account/edit', {
    method: 'POST',
    cookie: bobCookie,
    form: { handle: 'bob', bio: 'Bob builds things' },
  })
  expect(updateBob.status).toBe(303)
  const settings = await (await request('/account/edit', { cookie: bobCookie })).text()
  expect(settings).not.toContain('name="isBot"')
  const bobPostBody = 'A timeline note from Bob'
  expect((await request('/post', { method: 'POST', cookie: bobCookie, form: { body: bobPostBody } })).status).toBe(303)
  const bobPost = database.query('SELECT id FROM posts WHERE user_id=? AND body=?').get(bob.id, bobPostBody) as {
    id: number
  }
  expect(await (await request('/all')).text()).toContain(bobPostBody)
  expect(await (await request('/u/bob')).text()).toContain(bobPostBody)
  const forYouWithBobPost = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(forYouWithBobPost).toContain(bobPostBody)
  expect(forYouWithBobPost).not.toContain('class="quiet for-you-hide-action"')
  database.query('INSERT INTO posts(user_id,parent_id,body) VALUES(?,?,?)')
    .run(alice.id, bobPost.id, 'A reply quoting Bob')
  database.query('DELETE FROM feed_snapshots WHERE viewer_id=?').run(alice.id)
  const latestWithQuote = await (await request('/all', { cookie: aliceCookie })).text()
  expect(latestWithQuote).toContain('A reply quoting Bob')
  expect(latestWithQuote).toContain(bobPostBody)
  const latestAfterReplyRead = await (await request('/all', { cookie: aliceCookie })).text()
  expect(latestAfterReplyRead).toContain('A reply quoting Bob')
  expect(latestAfterReplyRead).toContain(bobPostBody)
  const forYouWithOwnReply = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(forYouWithOwnReply).toContain('A reply quoting Bob')
  const markedForYou = await request('/my-feed/read-all', { method: 'POST', cookie: aliceCookie })
  expect(markedForYou.status).toBe(303)
  expect(markedForYou.headers.get('location')).toBe('/my-feed')
  const readForYou = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(readForYou).not.toContain('action="/my-feed/read-all"')
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
  const bobProfileAsAlice = await (await request('/u/bob', { cookie: aliceCookie })).text()
  expect(bobProfileAsAlice).toContain('<span class="follows-you">follows you</span><button class="button" '
    + 'aria-label="follow back @bob">follow back</button>')
  await request('/tag-follow/shared', { method: 'POST', cookie: aliceCookie })
  await request('/tag-follow/shared', { method: 'POST', cookie: bobCookie })
  const unicodeTagFollow = await request('/tag-follow/' + encodeURIComponent('español'), {
    method: 'POST',
    cookie: aliceCookie,
    form: { from: '/latest#post-2' },
  })
  expect(unicodeTagFollow.status).toBe(303)
  expect(unicodeTagFollow.headers.get('location')).toBe('/latest?_scroll=instant#post-2')
  expect(database.query('SELECT 1 FROM hashtag_follows WHERE user_id=? AND tag=\'español\'').get(alice.id)).toBeTruthy()
  const invalidTagFollow = await request('/tag-follow/not-a-tag', { method: 'POST', cookie: aliceCookie })
  expect(invalidTagFollow.status).toBe(400)
  expect(invalidTagFollow.headers.get('content-type')).toBe('text/html;charset=utf-8')
  expect(await invalidTagFollow.text()).toContain('We couldn&#x27;t process that request.')
  database.query('UPDATE hashtag_follows SET created_at=\'2099-01-02 00:00:00\' WHERE user_id=? AND tag=\'shared\'')
    .run(bob.id)
  database.query(`INSERT INTO hashtag_follows(user_id,tag,created_at)
    VALUES(?,'historical','1970-01-01 00:00:00')`).run(bob.id)
  const includedHashtagActivity = await request('/account/edit/appearance', {
    method: 'POST',
    cookie: aliceCookie,
    form: { tab: 'misc', pageSize: '20', density: 'regular', includeHashtagFollowActivity: 'yes' },
  })
  expect(includedHashtagActivity.status).toBe(303)
  const followedTagFeed = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(followedTagFeed).toContain('<a class="reference-menu-trigger postauthor" '
    + 'href="/u/bob?from=%2Fmy-feed%23a-')
  expect(followedTagFeed).toContain('<span class="reference-popover-bio">Bob builds things</span>')
  expect(followedTagFeed).toContain('<a class="reference-menu-trigger" '
    + 'href="/tag/shared?from=%2Fmy-feed%23a-')
  expect(followedTagFeed).not.toContain('activity-follow-stats')
  expect(followedTagFeed).toContain('<form action="/tag-follow/shared" method="post">'
    + '<input type="hidden" name="from" value="/my-feed#a-')
  expect(followedTagFeed).not.toContain('<time dateTime="2099-01-02 00:00:00"')
  expect(followedTagFeed).not.toContain('<span aria-hidden="true">·</span><span>0 notes</span></a>')
  expect(followedTagFeed).not.toContain('@alice</a><span>followed</span><a href="/tag/shared">#shared</a>')
  expect(followedTagFeed).not.toContain('/tag/historical')
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
    method: 'POST',
    cookie: bobCookie,
    form: { body: 'Bot note discovered through #shared' },
  })
  expect(hashtagBotPost.status).toBe(303)
  const hashtagForYou = await (await request('/my-feed', { cookie: aliceCookie })).text()
    + await (await request('/my-feed?page=2', { cookie: aliceCookie })).text()
  expect(hashtagForYou).toContain('Bot note discovered through')
  expect(sharedReplyResponse.headers.get('location')).toBe(
    `/post/${post.id}?from=%2Flatest%3Fcursor%3Dabc%23post-1&to=${sharedReply.id}&back=${sharedReply.id}`
      + `#post-${sharedReply.id}`,
  )
  const sharedReplyPage = await request(sharedReplyResponse.headers.get('location')!, { cookie: bobCookie })
  const sharedReplyHtml = await sharedReplyPage.text()
  expect(sharedReplyHtml).toContain(
    'class="quiet post-back-link" href="/latest?cursor=abc#post-1">back</a>',
  )
  const threadProfileHref = `/u/bob?from=${
    encodeURIComponent(
      `/post/${post.id}?from=%2Flatest%3Fcursor%3Dabc%23post-1&to=${sharedReply.id}&back=${sharedReply.id}`,
    )
  }`.replaceAll('&', '&amp;')
  expect(sharedReplyHtml).toContain(`class="account-menu-handle" href="${threadProfileHref}">@bob</a>`)
  expect(sharedReplyHtml).toContain(`href="${threadProfileHref}">profile</a>`)
  expect(sharedReplyHtml).toContain(`action="/post/${sharedReply.id}/reply#post-${sharedReply.id}"`)
  expect(sharedReplyHtml).toContain('placeholder="Continue writing…"')
  const activityReadKey = `post:${sharedReply.id}`
  const forYouReadKey = `post:${String(sharedReply.id).padStart(20, '0')}`
  const visitedGeneralPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?) RETURNING id')
    .get(bob.id, 'general note read by visiting for you #shared') as { id: number }
  database.query('INSERT INTO post_hashtags(post_id,tag) VALUES(?,?)').run(visitedGeneralPost.id, 'shared')
  const visitedGeneralReadKey = `post:${String(visitedGeneralPost.id).padStart(20, '0')}`

  const latestBeforeForYou = await (await request('/all', { cookie: aliceCookie })).text()
  expect(latestBeforeForYou).toContain('my feed<span class="to-me-count">1</span></a>')
  await request('/my-feed', { cookie: aliceCookie })
  const latestAfterForYou = await (await request('/all', { cookie: aliceCookie })).text()
  expect(latestAfterForYou).toContain('href="/my-feed">')
  expect(database.query('SELECT 1 FROM activity_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, activityReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, forYouReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, visitedGeneralReadKey)).toBeTruthy()

  const unreadToMeHtml = await (await request('/@', { cookie: aliceCookie })).text()
  expect(unreadToMeHtml).not.toContain('action="/@/read-all"')
  expect(unreadToMeHtml).not.toContain('>first unread</a>')
  expect(unreadToMeHtml).toContain(
    'class="active" aria-current="page" href="/@">',
  )
  expect(unreadToMeHtml).toContain('@<span class="to-me-count">1</span></a>')
  expect(unreadToMeHtml).not.toContain('>all</a>')
  expect(unreadToMeHtml).toContain('activity-item-directed-unread')
  expect(unreadToMeHtml).toContain('class="unread-dot" aria-label="unread"')
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, forYouReadKey)).toBeTruthy()
  const revisitedToMeHtml = await (await request('/@', { cookie: aliceCookie })).text()
  expect(revisitedToMeHtml).toContain('href="/my-feed">my feed</a>')
  expect(revisitedToMeHtml).toContain(
    'class="active" aria-current="page" href="/@">',
  )
  expect(revisitedToMeHtml).not.toContain('class="unread-dot" aria-label="unread"')

  const generalFeedPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?) RETURNING id')
    .get(bob.id, 'unread general feed note') as { id: number }
  const generalFeedReadKey = `post:${String(generalFeedPost.id).padStart(20, '0')}`
  await request('/@/read-all', { method: 'POST', cookie: aliceCookie })
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
  await request('/my-feed/read-all', { method: 'POST', cookie: aliceCookie })
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, bulkGeneralReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM for_you_reads WHERE user_id=? AND event_key=?')
    .get(alice.id, bulkTargetedReadKey)).toBeTruthy()
  expect(database.query('SELECT 1 FROM latest_read_exceptions WHERE user_id=? AND post_id=?')
    .get(alice.id, bulkGeneralPost.id)).toBeTruthy()
  expect(database.query('SELECT 1 FROM latest_read_exceptions WHERE user_id=? AND post_id=?')
    .get(alice.id, bulkTargetedReply.id)).toBeTruthy()

  const insertActivityReply = database.query(
    'INSERT INTO posts(user_id,parent_id,body,created_at) VALUES(?,?,?,?)',
  )
  for (let index = 1; index <= 81; index++) {
    const createdAt = new Date(Date.UTC(2080, 0, index, 12)).toISOString().replace('T', ' ').slice(0, 19)
    insertActivityReply.run(bob.id, post.id, index === 1 ? 'oldest cursor boundary' : `activity cursor reply ${index}`,
      createdAt)
  }
  const activityFirstBody = await (await request('/@', { cookie: aliceCookie })).text()
  const activityNext = activityFirstBody.match(/href="(\/@\?page=2)"/)?.[1]
  expect(activityNext).toBeUndefined()
  expect(activityFirstBody).toContain('activity cursor reply 81')
  expect(activityFirstBody).toContain('oldest cursor boundary')
  expect(activityFirstBody).not.toContain('href="/@?page=2#')
  expect(activityFirstBody).not.toContain('action="/@/read-all"')
  insertActivityReply.run(bob.id, post.id, 'newer activity after cursor', '2080-02-01 12:00:00')
  const activitySecondBody = await (await request('/@?page=2', { cookie: aliceCookie })).text()
  expect(activitySecondBody).toContain('oldest cursor boundary')
  expect(activitySecondBody).toContain('activity cursor reply 81')
  expect(activitySecondBody).not.toContain('← prev')
  expect(activitySecondBody).toContain('newer activity after cursor')
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
    form: { reason: 'bot' },
  })
  expect(report.status).toBe(303)
  expect(report.headers.get('location')).toBe(`/post/${post.id}?reported=1`)
  const reportRow = database.query('SELECT id,status,reason FROM reports WHERE reporter_id=? AND post_id=?')
    .get(bob.id, post.id) as { id: number; status: string; reason: string }
  expect(reportRow).toMatchObject({ status: 'open', reason: 'bot' })

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
  expect(deleteEmail!.subject).toContain('@emaildelete')
  expect(deleteEmail!.text).toContain('account @emaildelete')
  expect(deleteEmail!.html).toContain('@emaildelete')
  const deletionToken = linkToken(deleteEmail!)
  const deletionReview = await request(`/account/delete?token=${encodeURIComponent(deletionToken)}`)
  expect(deletionReview.status).toBe(200)
  expect(await deletionReview.text()).toContain('Delete @emaildelete?')
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
  const adminActivity = await (await request('/my-feed', { cookie: adminCookie })).text()
  expect(adminActivity).toContain('>@admin</a>')
  expect(adminActivity).toContain('>@alice</a>')
  expect(adminActivity).toContain('<span class="activity-context">signed up.</span>')
  expect(adminActivity).not.toContain('activity-follow-stats')
  expect(adminActivity).not.toContain('href="/tag/null"')
  expect(adminActivity).not.toContain('>#null</a>')
  expect(adminActivity).toContain('activity-follow')
  expect(adminActivity).not.toContain('<p class="profile-bio bio-empty">No bio yet.</p>')
  expect(adminActivity).not.toContain('action="/follow/alice"')
  expect(adminActivity).not.toContain('<span class="follows-you">follows you</span>')
  expect(adminActivity).not.toContain('action="/follow/admin"')
  expect(adminActivity).not.toContain('action="/my-feed/read-all"')
  const markedActivity = await request('/activity/read-all', { method: 'POST', cookie: adminCookie })
  expect(markedActivity.status).toBe(303)
  expect(markedActivity.headers.get('location')).toBe('/@')
  const readAdminActivity = await (await request('/my-feed', { cookie: adminCookie })).text()
  expect(readAdminActivity).not.toContain('action="/my-feed/read-all"')
  expect(readAdminActivity).not.toContain('you&#x27;ve seen it all')
  const ordinaryActivity = await (await request('/my-feed', { cookie: aliceCookie })).text()
  expect(ordinaryActivity).not.toContain('signed up:</span>')
  const dashboard = await request('/admin', { cookie: adminCookie })
  expect(dashboard.status).toBe(200)
  expect(await dashboard.text()).toContain('A route-level integration post')
  const emailPage = await request('/admin/email', { cookie: adminCookie })
  expect(emailPage.status).toBe(200)
  const emailPageHtml = await emailPage.text()
  expect(emailPageHtml).toContain('action="/admin/email"')
  expect(emailPageHtml).toContain('name="from" value="textlog &lt;hello@textlog.cc&gt;"')
  const sendEmail = await request('/admin/email', {
    method: 'POST',
    cookie: adminCookie,
    form: {
      from: 'another sender <sender@example.com>',
      email: 'recipient@example.com',
      title: 'A custom title',
      body: 'Hello <friend>!',
    },
  })
  expect(sendEmail.status).toBe(303)
  expect(sendEmail.headers.get('location')).toBe('/admin/email?sent=1')
  expect(capturedEmails().at(-1)).toMatchObject({
    from: 'another sender <sender@example.com>',
    to: 'recipient@example.com',
    subject: 'A custom title',
    text: 'Hello <friend>!',
  })
  expect(capturedEmails().at(-1)?.html).toBeUndefined()
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
  expect(await moderateBob.text()).not.toContain('bot status')

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
  expect(userActions).toEqual([{ action: 'suspend_user' }, { action: 'restore_user' }])

  const testBlockAddress = '198.51.100.77'
  await request('/all', { ip: testBlockAddress })
  await request('/all', { ip: testBlockAddress })
  const today = new Date().toISOString().slice(0, 10)
  const ipHash = createHmac('sha256', 'route-integration-ip-secret')
    .update(`textlog\0http-log\0${today}\0${testBlockAddress}`).digest('hex')
  expect(ipHash).toBeDefined()
  let ipDashboardHtml = ''
  for (let attempt = 0; attempt < 20; attempt++) {
    ipDashboardHtml = await (await request('/admin', { cookie: adminCookie })).text()
    if (ipDashboardHtml.includes(`name="hash" value="${ipHash}"`)) break
    await Bun.sleep(25)
  }
  expect(ipDashboardHtml).toContain('top IPs today')
  expect(ipDashboardHtml).toContain(`name="hash" value="${ipHash}"`)
  const blockIp = await request('/admin/ip-blocks', {
    method: 'POST',
    cookie: adminCookie,
    form: { hash: ipHash! },
  })
  expect(blockIp.status).toBe(303)
  expect(database.query(`SELECT blocked_at FROM daily_ip_requests
    WHERE day=date('now') AND ip_hash=?`).get(ipHash!) as { blocked_at: string | null }).toMatchObject({
    blocked_at: expect.any(String),
  })
  const blockedRequest = await request('/all', { ip: testBlockAddress })
  expect(blockedRequest.status).toBe(429)
  expect(Number(blockedRequest.headers.get('retry-after'))).toBeGreaterThan(0)
}, 60_000)

test('signed-in users can follow deeply nested backlinks without a navigation challenge', async () => {
  const email = 'nested-navigation@example.com'
  const ip = '203.0.113.200'
  expect((await request('/enter', { method: 'POST', form: { email }, ip })).status).toBe(200)
  const message = capturedEmails().filter(item => item.to === email).at(-1)!
  const magic = await request(`/enter/magic?token=${encodeURIComponent(linkToken(message))}`, { ip })
  const cookie = sessionCookie(magic)
  expect((await request('/choose-handle', {
    method: 'POST', cookie, form: { handle: 'nested_user', next: '/' }, ip,
  })).status).toBe(303)

  const nested = '/about?from=%2Fpost%2F1%3Ffrom%3D%252Fpost%252F2%253Ffrom%253D%25252Fpost%25252F3%25253Ffrom%25253D%2525252Flatest'
  const response = await request(nested, { cookie, ip })
  expect(response.status).toBe(200)
  expect(response.headers.get('location')).toBeNull()
})

test('a nested navigation challenge gates every subsequent page for the resolved socket IP', async () => {
  const nested = '/?from=%2Fpost%2F1%3Ffrom%3D%252Fpost%252F2%253Ffrom%253D%25252Fpost%25252F3%25253Ffrom%25253D%2525252Flatest'
  const challenge = await request(nested)
  expect(challenge.status).toBe(303)
  expect(challenge.headers.get('location')).toStartWith('/navigation-check?target=')

  const otherPage = await request('/about')
  expect(otherPage.status).toBe(303)
  expect(otherPage.headers.get('location')).toBe('/navigation-check?target=%2Fabout')

  const challengePage = await request(challenge.headers.get('location')!)
  expect(challengePage.status).toBe(200)
  expect(await challengePage.text()).toContain('It looks like you might be a bot')
})
