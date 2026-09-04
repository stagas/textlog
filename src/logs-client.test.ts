import { expect, test } from 'bun:test'
import { httpLogPath, httpLogUsername } from './logs-path'

test('extracts request paths only from HTTP log entries', () => {
  expect(httpLogPath('Sep 04 12:34:56 http  GET     200     12ms  a1234  @alice  /post/42?from=%2Flatest  ua="Browser"'))
    .toBe('/post/42?from=%2Flatest')
  expect(httpLogPath('\x1b[2mhttp\x1b[0m  \x1b[34mGET   \x1b[0m  200     12ms  a1234  -  /latest'))
    .toBe('/latest')
  expect(httpLogPath('error  failed to load /post/42')).toBeNull()
  expect(httpLogPath('http  GET     200     12ms  a1234  -  //example.com')).toBeNull()
})

test('extracts authenticated usernames but not the anonymous marker', () => {
  expect(httpLogUsername('Sep 04 12:34:56 http  GET     200     12ms  a1234  @alice  /latest')).toBe('alice')
  expect(httpLogUsername('Sep 04 12:34:56 http  GET     200     12ms  a1234  -  /latest')).toBeNull()
})
