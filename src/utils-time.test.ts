import { expect, test } from 'bun:test'
import { fmt } from './utils'

const now = Date.UTC(2026, 7, 21, 12)
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', '')

test('formats relative timestamps in compact form', () => {
  expect(fmt(ago(0), now)).toBe('1s')
  expect(fmt(ago(15), now)).toBe('15s')
  expect(fmt(ago(60), now)).toBe('1m')
  expect(fmt(ago(3 * 60), now)).toBe('3m')
  expect(fmt(ago(5 * 60 * 60), now)).toBe('5h')
  expect(fmt(ago(24 * 60 * 60), now)).toBe('1d')
  expect(fmt(ago(3 * 7 * 24 * 60 * 60), now)).toBe('21d')
  expect(fmt(ago(30 * 24 * 60 * 60), now)).toBe('1mo')
  expect(fmt(ago(365 * 24 * 60 * 60), now)).toBe('1y')
})
