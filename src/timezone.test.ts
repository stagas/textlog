import { expect, test } from 'bun:test'
import { fmtFull } from './utils'
import { activeTimezone, validTimezone, withTimezone } from './timezone'

test('formats full timestamps in the request timezone', () => {
  expect(withTimezone('Etc/GMT+5', () => fmtFull('2026-08-16 12:00:00')))
    .toBe('Aug 16, 2026, 7:00 AM (UTC -05)')
  expect(withTimezone('Etc/GMT-2', () => fmtFull('2026-08-16 12:00:00')))
    .toBe('Aug 16, 2026, 2:00 PM (UTC +02)')
})

test('rejects unknown timezones and defaults request formatting to UTC', () => {
  expect(validTimezone('not/a-timezone')).toBe(false)
  expect(withTimezone('not/a-timezone', activeTimezone)).toBe('UTC')
})
