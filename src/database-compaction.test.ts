import { expect, test } from 'bun:test'
import { COMPACTION_MIN_FREE_PAGES, shouldCompactDatabase } from './database-compaction'

test('database compaction requires both substantial pages and a substantial ratio', () => {
  expect(shouldCompactDatabase(20_000, COMPACTION_MIN_FREE_PAGES - 1)).toBe(false)
  expect(shouldCompactDatabase(20_000, 2_000)).toBe(false)
  expect(shouldCompactDatabase(20_000, 4_000)).toBe(true)
})
