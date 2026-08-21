import { expect, test } from 'bun:test'
import { fmt } from './utils'

const now = Date.UTC(2026, 7, 21, 12)
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', '')

test('formats relative timestamps as full text', () => {
  expect(fmt(ago(5), now)).toBe('just now')
  expect(fmt(ago(15), now)).toBe('15 seconds ago')
  expect(fmt(ago(60), now)).toBe('1 minute ago')
  expect(fmt(ago(3 * 60), now)).toBe('3 minutes ago')
  expect(fmt(ago(5 * 60 * 60), now)).toBe('5 hours ago')
  expect(fmt(ago(24 * 60 * 60), now)).toBe('yesterday')
  expect(fmt(ago(2 * 24 * 60 * 60), now)).toBe('2 days ago')
  expect(fmt(ago(7 * 24 * 60 * 60), now)).toBe('last week')
  expect(fmt(ago(3 * 7 * 24 * 60 * 60), now)).toBe('3 weeks ago')
  expect(fmt(ago(30 * 24 * 60 * 60), now)).toBe('1 month ago')
})
