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

  test('preserves relative post links', () => {
    const body = 'See /post/123, (/post/456). /post/789?from=%2Flatest#post-789!'
    expect(normalizePostBody(body)).toBe(body)
  })

  test('condenses links to this site while preserving external links', () => {
    const previous = Bun.env.APP_URL
    Bun.env.APP_URL = 'https://textlog.test'
    try {
      expect(normalizePostBody('https://textlog.test/post/123?from=%2Fall#post-123, https://other.test/post/456'))
        .toBe('&123, https://other.test/post/456')
      expect(normalizePostBody('https://textlog.test/post/123/edit'))
        .toBe('https://textlog.test/post/123/edit')
      const code = '`https://textlog.test/post/123`\n```\nhttps://textlog.test/post/456\n```'
      expect(normalizePostBody(code)).toBe(code)
      expect(normalizePostBody('[post](https://textlog.test/post/789)'))
        .toBe('[post](https://textlog.test/post/789)')
    }
    finally {
      if (previous === undefined) delete Bun.env.APP_URL
      else Bun.env.APP_URL = previous
    }
  })

  test('still rejects empty and genuinely oversized bodies', () => {
    expect(validPostBody('   \n')).toBe(false)
    expect(validPostBody('x'.repeat(501))).toBe(false)
    expect(postBodyValidationMessage('   \n')).toBe('The note cannot be empty')
  })

  test('allows up to twenty lines and rejects twenty-one', () => {
    expect(validPostBody(Array(20).fill('x').join('\n'))).toBe(true)
    expect(validPostBody(Array(21).fill('x').join('\n'))).toBe(false)
  })

  test('reports exact counts for each exceeded limit', () => {
    const body = Array(21).fill('x').join('\n')
    expect(postBodyValidationMessage(body)).toBe('The note exceeds the limit: 21/20 lines.')
    expect(postBodyValidationMessage('x'.repeat(501))).toBe('The note cannot exceed 500 characters')

    const overBothLimits = `${'x'.repeat(484)}\n${Array(20).fill('x').join('\n')}`
    expect(postBodyValidationMessage(overBothLimits)).toBe(
      'The note exceeds the limit: 524/500 characters and 21/20 lines.',
    )
  })
})
