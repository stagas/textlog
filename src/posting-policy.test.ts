import { expect, test } from 'bun:test'
import { canPublishPosts } from './posting-policy'

test('posting verification policy bypasses verification only in development', () => {
  const unverified = { email_verified_at: null }
  expect(canPublishPosts(unverified, 'development')).toBe(true)
  expect(canPublishPosts(unverified, 'test')).toBe(false)
  expect(canPublishPosts(unverified, 'production')).toBe(false)
  expect(canPublishPosts({ email_verified_at: '2026-08-04 12:00:00' }, 'production')).toBe(true)
})
