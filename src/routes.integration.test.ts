import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { AUTH_LIMITS, rateLimitKey } from './auth-rate-limit'

setDefaultTimeout(30_000)

type CapturedEmail = { to: string; subject: string; text: string; html: string }

const projectRoot = resolve(dirname(import.meta.path), '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'root-mx-routes-'))
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

function sessionCookie(response: Response) {
  const cookie = response.headers.get('set-cookie')?.match(/(?:^|,\s*)(root=[^;]+)/)?.[1]
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

async function signup(handle: string, email: string, password: string) {
  const response = await request('/signup', { method: 'POST', form: { handle, email, password } })
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/explore?welcome=1')
  return sessionCookie(response)
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

test('consequential account, content, reporting, and admin flows work over HTTP', async () => {
  const originalPassword = 'correct horse battery staple'
  const newPassword = 'new correct horse battery staple'

  let aliceCookie = await signup('alice', 'alice@example.com', originalPassword)
  const alice = database.query('SELECT id,email_verified_at FROM users WHERE handle=?')
    .get('alice') as { id: number; email_verified_at: string | null }
  expect(alice.email_verified_at).toBeNull()

  const rawSession = aliceCookie.slice('root='.length)
  const storedSession = database.query('SELECT token_hash FROM sessions WHERE user_id=?')
    .get(alice.id) as { token_hash: string }
  expect(storedSession.token_hash).toHaveLength(64)
  expect(storedSession.token_hash).not.toBe(rawSession)

  const verificationEmail = capturedEmails().find(email => email.to === 'alice@example.com'
    && email.subject.includes('Verify email'))
  expect(verificationEmail).toBeDefined()
  const verificationToken = linkToken(verificationEmail!)

  const scannerVisit = await request(`/verify-email?token=${encodeURIComponent(verificationToken)}`)
  expect(scannerVisit.status).toBe(200)
  expect(await scannerVisit.text()).toContain('Verify your email?')
  expect((database.query('SELECT email_verified_at FROM users WHERE id=?').get(alice.id) as any).email_verified_at)
    .toBeNull()

  const verification = await request('/verify-email', {
    method: 'POST',
    form: { token: verificationToken },
  })
  expect(verification.status).toBe(303)
  expect(verification.headers.get('location')).toBe('/account/security?verified=1')
  expect((database.query('SELECT email_verified_at FROM users WHERE id=?').get(alice.id) as any).email_verified_at)
    .not.toBeNull()

  const logout = await request('/logout', { method: 'POST', cookie: aliceCookie })
  expect(logout.status).toBe(303)
  expect((database.query('SELECT count(*) count FROM sessions WHERE user_id=?').get(alice.id) as any).count).toBe(0)

  const rejectedLogin = await request('/login', {
    method: 'POST',
    form: { handle: 'alice', password: 'incorrect password' },
  })
  expect(rejectedLogin.status).toBe(401)

  const accountLimitKey = rateLimitKey(`user:${alice.id}`)
  const attempts = (database.query(`SELECT count(*) count FROM auth_rate_limits
    WHERE scope='login-account' AND key_hash=?`).get(accountLimitKey) as { count: number }).count
  const addAttempt = database.query(`INSERT INTO auth_rate_limits(scope,key_hash,created_at)
    VALUES('login-account',?,?)`)
  for (let index = attempts; index < AUTH_LIMITS.loginAccount.attempts; index++) {
    addAttempt.run(accountLimitKey, Date.now())
  }
  const accountLimitedLogin = await request('/login', {
    method: 'POST',
    form: { handle: 'alice@example.com', password: originalPassword },
  })
  expect(accountLimitedLogin.status).toBe(429)
  expect(accountLimitedLogin.headers.get('retry-after')).toBeTruthy()
  database.query("DELETE FROM auth_rate_limits WHERE scope='login-account' AND key_hash=?").run(accountLimitKey)

  const login = await request('/login', {
    method: 'POST',
    form: { handle: 'alice', password: originalPassword, next: '/write' },
  })
  expect(login.status).toBe(303)
  expect(login.headers.get('location')).toBe('/write')
  aliceCookie = sessionCookie(login)

  const forgot = await request('/forgot-password', {
    method: 'POST',
    form: { email: 'alice@example.com' },
  })
  expect(forgot.status).toBe(200)
  expect(await forgot.text()).toContain('Check your email')
  const resetEmail = capturedEmails().find(email => email.to === 'alice@example.com'
    && email.subject.includes('Reset your'))
  expect(resetEmail).toBeDefined()
  const resetToken = linkToken(resetEmail!)

  const resetPage = await request(`/reset-password?token=${encodeURIComponent(resetToken)}`)
  expect(resetPage.status).toBe(200)
  const reset = await request('/reset-password', {
    method: 'POST',
    form: { token: resetToken, password: newPassword, confirmPassword: newPassword },
  })
  expect(reset.status).toBe(303)
  expect(reset.headers.get('location')).toBe('/login?reset=1')
  expect((database.query('SELECT count(*) count FROM sessions WHERE user_id=?').get(alice.id) as any).count).toBe(0)

  const oldPasswordLogin = await request('/login', {
    method: 'POST',
    form: { handle: 'alice', password: originalPassword },
  })
  expect(oldPasswordLogin.status).toBe(401)
  const newPasswordLogin = await request('/login', {
    method: 'POST',
    form: { handle: 'alice', password: newPassword },
  })
  expect(newPasswordLogin.status).toBe(303)
  aliceCookie = sessionCookie(newPasswordLogin)

  const createPost = await request('/post', {
    method: 'POST',
    cookie: aliceCookie,
    form: { body: 'A route-level integration post' },
  })
  expect(createPost.status).toBe(303)
  expect(createPost.headers.get('location')).toBe('/latest')
  const post = database.query('SELECT id,body FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1')
    .get(alice.id) as { id: number; body: string }
  expect(post.body).toBe('A route-level integration post')
  const publicPost = await request(`/post/${post.id}`)
  expect(publicPost.status).toBe(200)
  expect(await publicPost.text()).toContain(post.body)
  const hotFeed = await request('/hot')
  expect(hotFeed.status).toBe(200)
  expect(await hotFeed.text()).toContain(post.body)

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
    FROM illegal_activity_reports WHERE post_id=?`).get(post.id) as
    { id: number; reference: string; status: string; reporter_email: string }
  expect(illegalReport).toMatchObject({ status: 'open', reporter_email: 'reporter-public@example.com' })
  expect(capturedEmails().some(email => email.to === 'reporter-public@example.com'
    && email.subject.includes('Report received'))).toBe(true)

  const bobCookie = await signup('bob', 'bob@example.com', 'bob password 123')
  const bob = database.query('SELECT id FROM users WHERE handle=?').get('bob') as { id: number }
  const unverifiedWritePage = await request('/write', { cookie: bobCookie })
  expect(unverifiedWritePage.status).toBe(200)
  expect(await unverifiedWritePage.text()).toContain('Confirm your email address before posting')
  const unverifiedPost = await request('/post', {
    method: 'POST',
    cookie: bobCookie,
    form: { body: 'This must not become public' },
  })
  expect(unverifiedPost.status).toBe(403)
  expect((database.query('SELECT count(*) count FROM posts WHERE user_id=?').get(bob.id) as any).count).toBe(0)
  const unverifiedReply = await request(`/post/${post.id}/reply`, {
    method: 'POST',
    cookie: bobCookie,
    form: { body: 'Neither should this reply' },
  })
  expect(unverifiedReply.status).toBe(403)
  expect((database.query('SELECT count(*) count FROM posts WHERE user_id=?').get(bob.id) as any).count).toBe(0)
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

  const adminCookie = await signup('admin', 'gstagas@gmail.com', 'admin password 123')
  const dashboard = await request('/admin', { cookie: adminCookie })
  expect(dashboard.status).toBe(200)
  expect(await dashboard.text()).toContain('A route-level integration post')
  const resolveIllegalReport = await request(`/admin/illegal-reports/${illegalReport.id}/resolve`, {
    method: 'POST', cookie: adminCookie, form: { reasons: 'Confirmed and actioned after human review of the report.' },
  })
  expect(resolveIllegalReport.status).toBe(303)
  expect((database.query('SELECT status FROM illegal_activity_reports WHERE id=?')
    .get(illegalReport.id) as { status: string }).status).toBe('resolved')
  expect(capturedEmails().some(email => email.to === 'reporter-public@example.com'
    && email.subject.includes('Report decision'))).toBe(true)

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
