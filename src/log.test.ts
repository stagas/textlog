import { describe, expect, test } from 'bun:test'
import { ipPseudonym, logIpPseudonym } from './ip-privacy'
import { clientIp, logHttp, semanticAction, shouldLogHttp } from './log'

describe('semanticAction', () => {
  test('names user actions without including identifiers', () => {
    expect(semanticAction('POST', '/post/42/reply')).toBe('post.reply')
    expect(semanticAction('POST', '/post/42/reply?from=thread')).toBe('post.reply')
    expect(semanticAction('POST', '/follow/alice')).toBe('user.follow.toggle')
    expect(semanticAction('POST', '/admin/users/9/suspend')).toBe('admin.user.suspend')
  })

  test('only treats mutations as actions', () => {
    expect(semanticAction('GET', '/post/42/edit')).toBeUndefined()
    expect(semanticAction('POST', '/something-new')).toBe('http.mutate')
  })
})

test('HTTP logs include the username, query parameters, and a safe bounded user agent', () => {
  const original = console.log
  let output = ''
  console.log = (...values: unknown[]) => {
    output = values.join(' ')
  }
  try {
    logHttp('GET', '/latest?limit=20&cursor=next', 200, 12, '203.0.113.4', 'alice', 'ExampleBot/1.0\nforged')
  }
  finally {
    console.log = original
  }
  expect(output).toContain(`${logIpPseudonym('203.0.113.4')}  @alice  /latest`)
  expect(output).toContain('/latest?limit=20&cursor=next')
  expect(output).toContain('ua="ExampleBot/1.0 forged"')
  expect(output).not.toContain('\n')
})

test('HTTP logs mark anonymous requests without a username', () => {
  const original = console.log
  let output = ''
  console.log = (...values: unknown[]) => {
    output = values.join(' ')
  }
  try {
    logHttp('GET', '/', 200, 12, '203.0.113.4')
  }
  finally {
    console.log = original
  }
  expect(output).toContain(`${logIpPseudonym('203.0.113.4')}  -  /`)
})

describe('shouldLogHttp', () => {
  test('hides successful dev reload polls but preserves failures', () => {
    expect(shouldLogHttp('/__dev/restart', 200)).toBe(false)
    expect(shouldLogHttp('/__dev/restart', 500)).toBe(true)
    expect(shouldLogHttp('/health', 200)).toBe(true)
  })
})

describe('clientIp', () => {
  test('uses the socket address by default', () => {
    const request = new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.4' } })
    expect(clientIp(request, '127.0.0.1')).toBe('127.0.0.1')
  })

  test('uses the first forwarded address when the proxy is trusted', () => {
    const previous = Bun.env.TRUST_PROXY
    Bun.env.TRUST_PROXY = 'true'
    try {
      const request = new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.4, 10.0.0.2' } })
      expect(clientIp(request, '127.0.0.1')).toBe('203.0.113.4')
    }
    finally {
      if (previous === undefined) delete Bun.env.TRUST_PROXY
      else Bun.env.TRUST_PROXY = previous
    }
  })
})

describe('IP pseudonyms', () => {
  test('uses daily rotation and purpose-separated keyed hashes', () => {
    const address = '203.0.113.4'
    const secret = 'test-secret-that-is-at-least-32-characters'
    const firstDay = new Date('2026-08-04T12:00:00Z')
    const nextDay = new Date('2026-08-05T12:00:00Z')
    const logging = ipPseudonym(address, 'http-log', firstDay, secret)
    expect(logging).toHaveLength(64)
    expect(logIpPseudonym(address, firstDay)).toHaveLength(5)
    expect(logging).not.toContain(address)
    expect(logging).not.toBe(ipPseudonym(address, 'visitor-count', firstDay, secret))
    expect(logging).not.toBe(ipPseudonym(address, 'http-log', nextDay, secret))
    expect(logging).not.toBe(ipPseudonym(address, 'http-log', firstDay, `${secret}-different`))
  })
})
