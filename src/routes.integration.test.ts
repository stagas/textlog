import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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
  for (let attempt = 0; attempt < 100; attempt++) {
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

function sessionCookie(response: Response) {
  const cookie = response.headers.get('set-cookie')?.match(/(?:^|,\s*)(textlog=[^;]+)/)?.[1]
  if (!cookie) throw new Error('Response did not set a session cookie')
  return cookie
}

async function request(path: string, options: {
  method?: 'GET' | 'POST'
  cookie?: string
  form?: Record<string, string>
} = {}) {
  const method = options.method || 'GET'
  const headers = new Headers()
  if (options.cookie) headers.set('cookie', options.cookie)
  if (method === 'POST') headers.set('origin', origin)
  return await fetch(`${origin}${path}`, {
    method,
    headers,
    body: options.form ? new URLSearchParams(options.form) : undefined,
    redirect: 'manual',
  })
}

async function signup(handle: string, email: string, _password: string) {
  const response = await request('/enter', { method: 'POST', form: { email } })
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
  expect(authenticatedHomeHtml).not.toContain('href="/login">login</a>')
  const cacheBustedHomeHtml = await (await request('/?v=94721')).text()
  expect(cacheBustedHomeHtml).toContain(`property="og:url" content="${origin}/?v=94721"`)
  const publicExplore = await request('/explore', { cookie: aliceCookie })
  expect(publicExplore.status).toBe(200)
  const publicExploreHtml = await publicExplore.text()
  expect(publicExploreHtml).toContain('class="account-nav"')
  expect(publicExploreHtml).toContain('@alice')
  expect(publicExploreHtml).toContain('action="/search"')
  const welcomeExplore = await request('/explore?welcome=1', { cookie: aliceCookie })
  expect(await welcomeExplore.text()).not.toContain('action="/search"')
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
  expect(await clientError.text()).toContain("We couldn&#x27;t process that request.")
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
    method: 'POST', cookie: aliceCookie, form: {},
  })
  expect(passwordSetupRequest.status).toBe(200)
  const passwordSetupEmail = capturedEmails().filter(message => message.to === 'alice@example.com'
    && message.subject.includes('Enable password login')).at(-1)
  expect(passwordSetupEmail).toBeDefined()
  const passwordSetupToken = linkToken(passwordSetupEmail!)
  const passwordSetupPage = await request(
    `/account/password/enable?token=${encodeURIComponent(passwordSetupToken)}`, { cookie: aliceCookie },
  )
  expect(await passwordSetupPage.text()).toContain('Set a password')
  const enabledPassword = await request('/account/password/enable', {
    method: 'POST', cookie: aliceCookie,
    form: { token: passwordSetupToken, newPassword: 'alice password 123' },
  })
  expect(enabledPassword.status).toBe(303)
  expect(enabledPassword.headers.get('location')).toBe('/account/security?enabled=password')
  const passwordLogin = await request('/enter/password', {
    method: 'POST', form: { identifier: '@alice', password: 'alice password 123', next: '/account/security' },
  })
  expect(passwordLogin.status).toBe(303)
  expect(passwordLogin.headers.get('location')).toBe('/account/security')
  aliceCookie = sessionCookie(passwordLogin)
  const changedPassword = await request('/account/password/change', {
    method: 'POST', cookie: aliceCookie,
    form: { oldPassword: 'alice password 123', newPassword: 'alice password 456' },
  })
  expect(changedPassword.status).toBe(303)
  const forgotPassword = await request('/forgot-password', {
    method: 'POST', form: { email: 'alice@example.com' },
  })
  expect(forgotPassword.status).toBe(200)
  const resetEmail = capturedEmails().filter(message => message.to === 'alice@example.com'
    && message.subject.includes('Reset your')).at(-1)
  expect(resetEmail).toBeDefined()
  const resetToken = linkToken(resetEmail!)
  const resetPassword = await request('/reset-password', {
    method: 'POST', form: { token: resetToken, password: 'alice password 789', confirmPassword: 'alice password 789' },
  })
  expect(resetPassword.status).toBe(303)
  expect(resetPassword.headers.get('location')).toBe('/enter/password?reset=1')
  const reusedReset = await request(`/reset-password?token=${encodeURIComponent(resetToken)}`)
  expect(reusedReset.status).toBe(400)
  const resetLogin = await request('/enter/password', {
    method: 'POST', form: { identifier: 'alice@example.com', password: 'alice password 789' },
  })
  expect(resetLogin.status).toBe(303)
  aliceCookie = sessionCookie(resetLogin)

  const createPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A route-level integration post' },
  })
  expect(createPost.status).toBe(303)
  expect(createPost.headers.get('location')).toBe('/latest')

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
  expect(await unsupportedPost.text()).toContain("We couldn&#x27;t read that request.")

  const post = database.query('SELECT id,body FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1')
    .get(alice.id) as { id: number; body: string }
  expect(post.body).toBe('A route-level integration post')
  const search = await request('/search?q=route-level', { cookie: aliceCookie })
  expect(search.status).toBe(200)
  expect(search.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  const searchHtml = await search.text()
  expect(searchHtml).toContain('1 result for “route-level”')
  expect(searchHtml).toContain('A <mark>route</mark>-<mark>level</mark> integration post')
  const publicPost = await request(`/post/${post.id}`)
  expect(publicPost.status).toBe(200)
  expect(publicPost.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=120')
  expect(publicPost.headers.get('vary')).toContain('Cookie')
  expect(await publicPost.text()).toContain(post.body)
  const privatePost = await request(`/post/${post.id}`, { cookie: aliceCookie })
  expect(privatePost.headers.get('cache-control')).toBe('private, no-store')
  const privateReplyForm = await request(`/post/${post.id}?reply=1`, { cookie: aliceCookie })
  expect(privateReplyForm.headers.get('cache-control')).toBe('private, no-store')
  const hotFeed = await request('/hot')
  expect(hotFeed.status).toBe(200)
  expect(await hotFeed.text()).toContain(post.body)

  const insertFeedPost = database.query('INSERT INTO posts(user_id,body) VALUES(?,?)')
  for (let index = 1; index <= 21; index++) insertFeedPost.run(alice.id, `cursor note ${index}`)
  const latestFirst = await request('/latest')
  const latestFirstBody = await latestFirst.text()
  const latestNext = latestFirstBody.match(/href="(\/latest\?cursor=[^"]+)"/)?.[1]
  expect(latestNext).toBeTruthy()
  expect(latestFirstBody).toContain('cursor note 21')
  expect(latestFirstBody).not.toContain(post.body)
  const latestSecondBody = await (await request(latestNext!)).text()
  expect(latestSecondBody).toContain(post.body)
  expect(latestSecondBody).toContain('← prev')

  const forYouFirstBody = await (await request('/for-you', { cookie: aliceCookie })).text()
  const forYouNext = forYouFirstBody.match(/href="(\/for-you\?cursor=[^"]+)"/)?.[1]
  expect(forYouNext).toBeTruthy()
  expect(forYouFirstBody).toContain('cursor note 21')
  expect(forYouFirstBody).not.toContain(post.body)
  const forYouSecondBody = await (await request(forYouNext!, { cookie: aliceCookie })).text()
  expect(forYouSecondBody).toContain(post.body)
  expect(forYouSecondBody).toContain('← prev')

  const profileFirstBody = await (await request('/u/alice')).text()
  const profileNext = profileFirstBody.match(/href="(\/u\/alice\?cursor=[^"]+)"/)?.[1]
  expect(profileNext).toBeTruthy()
  expect(profileFirstBody).not.toContain(post.body)
  expect(await (await request(profileNext!)).text()).toContain(post.body)
  expect((await request('/latest?cursor=broken')).status).toBe(400)
  expect((await request('/for-you?cursor=broken', { cookie: aliceCookie })).status).toBe(400)
  expect((await request('/?cursor=broken', { cookie: aliceCookie })).status).toBe(400)
  expect((await request('/u/alice?cursor=broken')).status).toBe(400)

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
    method: 'POST', cookie: emailDeleteCookie, form: { email: 'email-delete-new@example.com' },
  })
  expect(emailChangeRequest.status).toBe(200)
  expect((database.query('SELECT email FROM users WHERE handle=?').get('emaildelete') as { email: string }).email)
    .toBe('email-delete@example.com')
  const approvalEmail = capturedEmails().filter(message => message.to === 'email-delete@example.com'
    && message.subject.includes('Approve email change')).at(-1)
  expect(approvalEmail).toBeDefined()
  const approvalToken = linkToken(approvalEmail!)
  expect((await request(`/account/email/change/authorize?token=${encodeURIComponent(approvalToken)}`)).status).toBe(200)
  const approvedChange = await request('/account/email/change/authorize', {
    method: 'POST', form: { token: approvalToken },
  })
  expect(approvedChange.status).toBe(200)
  const newEmailConfirmation = capturedEmails().filter(message => message.to === 'email-delete-new@example.com'
    && message.subject.includes('Confirm new email')).at(-1)
  expect(newEmailConfirmation).toBeDefined()
  const newEmailToken = linkToken(newEmailConfirmation!)
  const changedEmail = await request('/verify-email', { method: 'POST', form: { token: newEmailToken } })
  expect(changedEmail.status).toBe(303)
  expect((database.query('SELECT email FROM users WHERE handle=?').get('emaildelete') as { email: string }).email)
    .toBe('email-delete-new@example.com')

  const emailDeleteRequest = await request('/account/delete', {
    method: 'POST', cookie: emailDeleteCookie, form: {},
  })
  expect(emailDeleteRequest.status).toBe(200)
  expect((database.query('SELECT deleted_at FROM users WHERE handle=?').get('emaildelete') as
    { deleted_at: string | null }).deleted_at).toBeNull()
  const deleteEmail = capturedEmails().filter(message => message.to === 'email-delete-new@example.com'
    && message.subject.includes('Confirm account deletion')).at(-1)
  expect(deleteEmail).toBeDefined()
  const deletionToken = linkToken(deleteEmail!)
  const deletionReview = await request(`/account/delete?token=${encodeURIComponent(deletionToken)}`)
  expect(deletionReview.status).toBe(200)
  expect((database.query('SELECT deleted_at FROM users WHERE handle=?').get('emaildelete') as
    { deleted_at: string | null }).deleted_at).toBeNull()
  const confirmedDeletion = await request('/account/delete', {
    method: 'POST', form: { token: deletionToken },
  })
  expect(confirmedDeletion.status).toBe(303)
  expect(database.query('SELECT 1 FROM users WHERE handle=?').get('emaildelete')).toBeNull()

  const passwordDeleteCookie = await signup('passworddelete', 'password-delete@example.com', 'unused')
  await request('/account/password/enable', { method: 'POST', cookie: passwordDeleteCookie, form: {} })
  const deletePasswordEmail = capturedEmails().filter(message => message.to === 'password-delete@example.com'
    && message.subject.includes('Enable password login')).at(-1)
  expect(deletePasswordEmail).toBeDefined()
  await request('/account/password/enable', {
    method: 'POST', cookie: passwordDeleteCookie,
    form: { token: linkToken(deletePasswordEmail!), newPassword: 'delete password 123' },
  })
  const rejectedDeletion = await request('/account/delete', {
    method: 'POST', cookie: passwordDeleteCookie, form: { password: 'wrong password' },
  })
  expect(rejectedDeletion.status).toBe(400)
  expect(database.query('SELECT 1 FROM users WHERE handle=? AND deleted_at IS NULL').get('passworddelete'))
    .toBeTruthy()
  const passwordDeletion = await request('/account/delete', {
    method: 'POST', cookie: passwordDeleteCookie, form: { password: 'delete password 123' },
  })
  expect(passwordDeletion.status).toBe(303)
  expect(database.query('SELECT 1 FROM users WHERE handle=?').get('passworddelete')).toBeNull()

  const adminCookie = await signup('admin', 'gstagas@gmail.com', 'admin password 123')
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
    html: '<div style="white-space: pre-wrap">Hello &lt;friend&gt;!</div>',
  })
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
})
