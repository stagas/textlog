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

  test('asks authors with too many lines to reduce them', () => {
    const body = Array(11).fill('x').join('\n')
    expect(postBodyValidationMessage(body)).toBe(
      'Posts can contain up to 10 lines. Please reduce the number of lines.',
    )
  })
})
