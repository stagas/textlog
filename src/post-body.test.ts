import { describe, expect, test } from 'bun:test'
import { normalizePostBody, postBodyValidationMessage, validPostBody } from './post-body'

describe('post bodies', () => {
  test('counts submitted textarea line breaks as one character', () => {
    const submitted = `${'x'.repeat(277)}\r\n`
    const body = normalizePostBody(submitted)

    expect(body).toHaveLength(278)
    expect(validPostBody(body)).toBe(true)
  })

  test('normalizes old-Mac and Windows line endings', () => {
    expect(normalizePostBody('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })

  test('still rejects empty and genuinely oversized bodies', () => {
    expect(validPostBody('   \n')).toBe(false)
    expect(validPostBody('x'.repeat(281))).toBe(false)
  })

  test('allows up to ten lines and rejects eleven', () => {
    expect(validPostBody(Array(10).fill('x').join('\n'))).toBe(true)
    expect(validPostBody(Array(11).fill('x').join('\n'))).toBe(false)
  })

  test('reports exact counts for each exceeded limit', () => {
    const body = Array(11).fill('x').join('\n')
    expect(postBodyValidationMessage(body)).toBe('The note exceeds the limit: 11/10 lines.')
    expect(postBodyValidationMessage('x'.repeat(281))).toBe('The note exceeds the limit: 281/280 characters.')

    const overBothLimits = `${'x'.repeat(279)}\n${Array(11).fill('x').join('\n')}`
    expect(postBodyValidationMessage(overBothLimits)).toBe(
      'The note exceeds the limit: 301/280 characters and 12/10 lines.',
    )
  })
})
