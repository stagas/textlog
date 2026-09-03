import { expect, test } from 'bun:test'
import { logTimestamp } from './console-timestamps'

test('formats log timestamps like syslog timestamps', () => {
  expect(logTimestamp(new Date(2026, 8, 3, 17, 39, 16))).toBe('Sep 03 17:39:16')
})
