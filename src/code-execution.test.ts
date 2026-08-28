import { describe, expect, test } from 'bun:test'
import { displayedExecutionOutput, executableCode, executePostCode } from './code-execution'

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

  test('folds output to the first eight lines, an ellipsis, and the last line only when rendered', async () => {
    const output = await executePostCode('#exec\n```js\nfor (let i = 1; i <= 12; i++) console.log(i)\n```',
      'development')
    expect(output?.split('\n')).toHaveLength(12)
    expect(displayedExecutionOutput(output!).split('\n'))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '…', '12'])
  })

  test('limits every rendered output line to 200 characters', () => {
    const displayed = displayedExecutionOutput(`${'a'.repeat(250)}\nshort\n${'b'.repeat(201)}`).split('\n')
    expect(displayed[0]).toBe(`${'a'.repeat(199)}…`)
    expect(displayed[1]).toBe('short')
    expect(displayed[2]).toBe(`${'b'.repeat(199)}…`)
    expect(displayed.every(line => line.length <= 200)).toBe(true)
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
