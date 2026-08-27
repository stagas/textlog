import { describe, expect, test } from 'bun:test'
import { executableCode, executePostCode } from './code-execution'

describe('executable notes', () => {
  test('requires a standalone exec hashtag and a language fence', () => {
    expect(executableCode('#exec\n```js\nconsole.log(1)\n```')).toEqual({ language: 'js', code: 'console.log(1)' })
    expect(executableCode('hello #exec\n```js\nconsole.log(1)\n```')).toBeNull()
    expect(executableCode('#exec\n```\nconsole.log(1)\n```')).toBeNull()
  })

  test('executes JavaScript locally and captures console output', async () => {
    expect(await executePostCode('#exec\n```js\nconsole.log("answer", 6 * 7)\n```', 'development'))
      .toBe('answer 42')
  })

  test('does not execute other languages in development', async () => {
    expect(await executePostCode('#exec\n```python\nprint(42)\n```', 'development'))
      .toContain('only supports JavaScript')
  })
})
