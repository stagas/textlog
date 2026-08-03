import { describe, expect, test } from 'bun:test'
import { semanticAction, shouldLogHttp } from './log'

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
