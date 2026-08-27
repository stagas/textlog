import { describe, expect, test } from 'bun:test'
import { executableCode, executePostCode } from './code-execution'

describe('executable notes', () => {
  test('requires a standalone exec hashtag and a language fence', () => {
    expect(executableCode('#exec\n```js\nconsole.log(1)\n```')).toEqual({ language: 'js', code: 'console.log(1)' })
    expect(executableCode('hello #execute\n```js\nconsole.log(1)\n```')).toBeNull()
    expect(executableCode('#exec\n```\nconsole.log(1)\n```')).toBeNull()
  })

  test('runs the first code fence after an exec marker anywhere in the note', () => {
    expect(executableCode('An example:\n```js\nconsole.log("not this")\n```\n\nRun this:\n#exec\n```js\n'
      + 'console.log("this one")\n```\nAfterwards.')).toEqual({ language: 'js', code: 'console.log("this one")' })
    expect(executableCode('Please run this #exec\n```js\nconsole.log(42)\n```'))
      .toEqual({ language: 'js', code: 'console.log(42)' })
    expect(executableCode('```text\n#exec\n```\n```js\nconsole.log(42)\n```')).toBeNull()
  })

  test('executes JavaScript locally and captures console output', async () => {
    expect(await executePostCode('#exec\n```js\nconsole.log("answer", 6 * 7)\n```', 'development'))
      .toBe('answer 42')
  })

  test('does not execute other languages in development', async () => {
    expect(await executePostCode('#exec\n```python\nprint(42)\n```', 'development'))
      .toContain('only supports JavaScript')
  })

  test('sends conventional fence aliases as Piston language names', async () => {
    const originalFetch = globalThis.fetch
    let requestBody: unknown
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return Response.json({ run: { output: '42\n' } })
    }) as typeof fetch
    try {
      expect(await executePostCode('#exec\n```js\nconsole.log(6 * 7)\n```', 'production',
        'http://localhost:2000')).toBe('42\n')
      expect(requestBody).toMatchObject({ language: 'javascript', version: '*' })
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })
})
