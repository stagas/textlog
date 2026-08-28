import { describe, expect, test } from 'bun:test'
import { normalizePostBody, postBodyValidationMessage, validPostBody } from './post-body'

describe('post bodies', () => {
  test('counts submitted textarea line breaks as one character', () => {
    const submitted = `${'x'.repeat(497)}\r\n`
    const body = normalizePostBody(submitted)

    expect(body).toHaveLength(498)
    expect(validPostBody(body)).toBe(true)
  })

  test('normalizes old-Mac and Windows line endings', () => {
    expect(normalizePostBody('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })

  test('still rejects empty and genuinely oversized bodies', () => {
    expect(validPostBody('   \n')).toBe(false)
    expect(validPostBody('x'.repeat(501))).toBe(false)
  })

  test('allows up to fifteen lines and rejects sixteen', () => {
    expect(validPostBody(Array(15).fill('x').join('\n'))).toBe(true)
    expect(validPostBody(Array(16).fill('x').join('\n'))).toBe(false)
  })

  test('reports exact counts for each exceeded limit', () => {
    const body = Array(16).fill('x').join('\n')
    expect(postBodyValidationMessage(body)).toBe('The note exceeds the limit: 16/15 lines.')
    expect(postBodyValidationMessage('x'.repeat(501))).toBe('The note exceeds the limit: 501/500 characters.')

    const overBothLimits = `${'x'.repeat(484)}\n${Array(16).fill('x').join('\n')}`
    expect(postBodyValidationMessage(overBothLimits)).toBe(
      'The note exceeds the limit: 516/500 characters and 17/15 lines.',
    )
  })
})
