import { expect, test } from 'bun:test'
import { materializedForYouCount } from './database-domain'

test('reads the My Feed badge count from materialized feed HTML', () => {
  expect(materializedForYouCount('<a href="/my-feed">my feed</a>')).toBe(0)
  expect(materializedForYouCount(
    '<a class="active" href="/my-feed">my feed<span class="to-me-count">12</span></a>',
  )).toBe(12)
})
