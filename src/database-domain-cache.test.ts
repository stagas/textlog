import { expect, test } from 'bun:test'
import { materializedForYouCount } from './database-domain'

test('reads the For You badge count from materialized feed HTML', () => {
  expect(materializedForYouCount('<a href="/for-you">for you</a>')).toBe(0)
  expect(materializedForYouCount(
    '<a class="active" href="/for-you">for you<span class="to-me-count">12</span></a>',
  )).toBe(12)
})
