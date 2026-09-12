import { expect, test } from 'bun:test'
import { appOrigin } from './brand'
import { isCurlRequest, terminalFeed } from './terminal-feed'

test('recognizes curl without treating browsers as terminal clients', () => {
  expect(isCurlRequest(new Request('https://textlog.test', { headers: { 'user-agent': 'curl/8.7.1' } }))).toBeTrue()
  expect(isCurlRequest(new Request('https://textlog.test', { headers: { 'user-agent': 'Mozilla/5.0' } }))).toBeFalse()
})

test('renders a minimal ANSI new-post feed', () => {
  const output = terminalFeed({
    posts: [
      { id: 2, user_id: 2, parent_id: null,
        body: '**Hello** @friend about #Terminal \x1b[31mnot injected\x1b[0m [site](https://example.test)',
        created_at: '2026-09-12T11:59:30Z', deleted_at: null, handle: 'alice', reply_count: 2 },
      { id: 3, user_id: 3, parent_id: 2, body: 'hidden reply', created_at: '2026-09-12T11:59:40Z',
        deleted_at: null, handle: 'bob' },
    ],
    page: 1,
    totalItems: 1,
    totalPages: 1,
  }, 'https://textlog.test/', 'new', Date.parse('2026-09-12T12:00:00Z'))

  expect(output).toContain('\x1b[1mtextlog\x1b[0m  \x1b[38;2;116;150;104mnew\x1b[0m')
  expect(output).toContain('\x1b[38;2;116;150;104m@alice\x1b[0m')
  expect(output).toContain(`${appOrigin() || 'https://textlog.test'}/post/2 · 30s`)
  expect(output).toContain('\x1b[38;2;116;150;104m@friend\x1b[0m')
  expect(output).toContain('\x1b[38;2;116;150;104m#Terminal\x1b[0m')
  expect(output).toContain('not injected site')
  expect(output).not.toContain('\x1b[31m')
  expect(output).toContain('└── \x1b[38;2;116;150;104m@bob\x1b[0m')
  expect(output).toContain('    hidden reply')
  expect(output).not.toContain('<')
})

test('labels other terminal feeds and keeps orphaned replies visible', () => {
  const feed = {
    posts: [{ id: 3, user_id: 3, parent_id: 2, body: 'a reply', created_at: '2026-09-12T11:59:40Z',
      deleted_at: null, handle: 'bob' }],
    page: 1,
    totalItems: 1,
    totalPages: 1,
  }
  expect(terminalFeed(feed, 'https://textlog.test/all', 'all')).toContain('a reply')
  expect(terminalFeed(feed, 'https://textlog.test/hot', 'hot')).toContain('a reply')
})

test('renders nested replies like tree', () => {
  const output = terminalFeed({
    posts: [
      { id: 1, user_id: 1, parent_id: null, body: 'root', created_at: '2026-09-12T12:00:00Z',
        deleted_at: null, handle: 'root' },
      { id: 2, user_id: 2, parent_id: 1, body: 'first', created_at: '2026-09-12T12:00:00Z',
        deleted_at: null, handle: 'first' },
      { id: 3, user_id: 3, parent_id: 1, body: 'last', created_at: '2026-09-12T12:00:00Z',
        deleted_at: null, handle: 'last' },
      { id: 4, user_id: 4, parent_id: 2, body: 'nested', created_at: '2026-09-12T12:00:00Z',
        deleted_at: null, handle: 'nested' },
    ],
    page: 1, totalItems: 1, totalPages: 1,
  }, 'https://textlog.test/new', 'new')

  const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  expect(plain).toContain('\n├── @first')
  expect(plain).toContain('\n│   first\n│   └── @nested')
  expect(plain).toContain('\n└── @last')
  expect(plain).toContain('\n    last')
})

test('uses the configured public origin for post URLs', () => {
  const previous = Bun.env.APP_URL
  Bun.env.APP_URL = 'https://public.textlog.test/'
  try {
    const output = terminalFeed({
      posts: [{ id: 7, user_id: 1, parent_id: null, body: 'hello', created_at: new Date().toISOString(),
        deleted_at: null, handle: 'alice' }],
      page: 1, totalItems: 1, totalPages: 1,
    }, 'http://internal:3000/new', 'new')
    expect(output).toContain('https://public.textlog.test/post/7')
    expect(output).not.toContain('http://internal:3000/post/7')
  }
  finally {
    if (previous === undefined) delete Bun.env.APP_URL
    else Bun.env.APP_URL = previous
  }
})
