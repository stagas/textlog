import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sendFriendInvitation, sendMagicLink, sendReportDecision } from './email'

const previous = {
  NODE_ENV: Bun.env.NODE_ENV,
  EMAIL_CAPTURE_PATH: Bun.env.EMAIL_CAPTURE_PATH,
  APP_NAME: Bun.env.APP_NAME,
  APP_URL: Bun.env.APP_URL,
}
const directory = mkdtempSync(join(tmpdir(), 'textlog-email-'))
const capturePath = join(directory, 'messages.jsonl')

beforeAll(() => {
  Bun.env.NODE_ENV = 'test'
  Bun.env.EMAIL_CAPTURE_PATH = capturePath
  Bun.env.APP_NAME = 'textlog'
  Bun.env.APP_URL = 'https://textlog.cc'
})

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete Bun.env[key]
    else Bun.env[key] = value
  }
  rmSync(directory, { recursive: true, force: true })
})

function messages() {
  return readFileSync(capturePath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

test('HTML emails use the site palette, square panel, compact typography, logo, and preheader', async () => {
  await sendMagicLink('reader@example.com', 'https://textlog.cc/enter?token=a&b=c', '123456', 'reader')
  const message = messages().at(-1)

  expect(message.html).toContain('<!doctype html>')
  expect(message.html).toContain('background:#ffffff')
  expect(message.html).toContain('bgcolor="#f1f5ee"')
  expect(message.html).toContain('border:1px solid #d9dbd4')
  expect(message.html).not.toContain('border-radius')
  expect(message.html).toContain('<h1 style="margin:0 0 16px;color:#55734a')
  expect(message.html).toContain('<td align="center" bgcolor="#749668">')
  expect(message.html).toContain('align="center" bgcolor="#f1f5ee"')
  expect(message.html).toContain('align="center" cellpadding="0"')
  expect(message.html).toContain('ui-monospace,SFMono-Regular,Menlo')
  expect(message.html).toContain('<img src="https://textlog.cc/email-logo.png?v=1" width="24" height="24"')
  expect(message.html).not.toContain('&gt;_</span>')
  expect(message.html).toContain('>textlog</span>')
  expect(message.html).toContain('display:none;max-height:0;overflow:hidden')
  expect(message.html).toContain('href="https://textlog.cc/enter?token=a&amp;b=c"')
  expect(message.html).toContain('font-size:13px;line-height:1.65')
  expect(message.html).toContain('letter-spacing:5px;text-align:center">123456')
  expect(message.text).toContain('https://textlog.cc/enter?token=a&b=c')
})

test('HTML emails escape externally supplied report details', async () => {
  await sendReportDecision('reader@example.com', '<reference>', '<accepted>', '<script>alert(1)</script>')
  const message = messages().at(-1)

  expect(message.html).toContain('&lt;reference&gt;')
  expect(message.html).toContain('&lt;accepted&gt;')
  expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(message.html).not.toContain('<script>')
})

test('friend invitation uses the inviter copy and a styled magic-link action', async () => {
  await sendFriendInvitation('friend@example.com', 'https://textlog.cc/enter/magic?token=invite', 'alice')
  const message = messages().at(-1)

  expect(message.subject).toBe('You\'ve been invited to textlog')
  expect(message.text).toContain('Your friend @alice has invited you to join textlog.')
  expect(message.text).toContain('Click on this magic link to join:')
  expect(message.text).toContain('This link expires in one week and can only be used once.')
  expect(message.html).toContain('Your friend @alice has invited you to join textlog.')
  expect(message.html).toContain('Click on this magic link to join.')
  expect(message.html).toContain('>Join textlog <span aria-hidden="true">→</span>')
})
