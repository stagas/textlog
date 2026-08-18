import { expect, test } from 'bun:test'
import { RESPONSE_TIME_PLACEHOLDER, updateResponseTime } from './response-time'

test('adds a rounded response time to rendered and materialized HTML', () => {
  const materializedHtml = `<footer>${RESPONSE_TIME_PLACEHOLDER}</footer>`

  expect(updateResponseTime(materializedHtml, 12.6)).toBe('<footer>13ms</footer>')
  expect(updateResponseTime(materializedHtml, 2.1)).toBe('<footer>2ms</footer>')
})
