import { describe, expect, test } from 'bun:test'
import { clientIp, semanticAction, shouldLogHttp } from './log'

describe('semanticAction', () => {
  test('names user actions without including identifiers', () => {
    expect(semanticAction('POST', '/post/42/reply')).toBe('post.reply')
    expect(semanticAction('POST', '/follow/alice')).toBe('user.follow.toggle')
    expect(semanticAction('POST', '/admin/users/9/suspend')).toBe('admin.user.suspend')
  })

  test('only treats mutations as actions', () => {
    expect(semanticAction('GET', '/post/42/edit')).toBeUndefined()
    expect(semanticAction('POST', '/something-new')).toBe('http.mutate')
  })
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
