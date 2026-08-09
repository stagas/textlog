import { describe, expect, test } from 'bun:test'
import { isDevelopment } from './environment'

describe('development environment', () => {
  test('recognizes explicit development and dev-reload mode', () => {
    expect(isDevelopment('development', 'false')).toBe(true)
    expect(isDevelopment('production', 'true')).toBe(true)
    expect(isDevelopment('test', 'false')).toBe(false)
    expect(isDevelopment('production', 'false')).toBe(false)
  })
})
