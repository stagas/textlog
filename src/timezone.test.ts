import { expect, test } from 'bun:test'
import { activeTimezone, validTimezone, withTimezone } from './timezone'
import { fmtFull } from './utils'

test('formats full timestamps in the request timezone', () => {
  expect(withTimezone('Europe/Athens', () => fmtFull('2026-01-16 12:00:00')))
    .toBe('Jan 16, 2026, 2:00 PM (UTC +02)')
  expect(withTimezone('Europe/Athens', () => fmtFull('2026-08-16 12:00:00')))
    .toBe('Aug 16, 2026, 3:00 PM (UTC +03)')
})

test('rejects unknown timezones and defaults request formatting to UTC', () => {
  expect(validTimezone('not/a-timezone')).toBe(false)
  expect(withTimezone('not/a-timezone', activeTimezone)).toBe('UTC')
})
