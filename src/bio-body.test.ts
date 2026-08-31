import { describe, expect, test } from 'bun:test'
import { bioBodyValidationMessage, normalizeBioBody, validBioBody } from './bio-body'

describe('bio bodies', () => {
  test('allows up to 300 characters and ten lines', () => {
    expect(validBioBody('x'.repeat(300))).toBe(true)
    expect(validBioBody(Array(10).fill('x').join('\n'))).toBe(true)
    expect(validBioBody(Array(11).fill('x').join('\n'))).toBe(false)
  })

  test('normalizes submitted line endings', () => {
    expect(normalizeBioBody('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })

  test('reports exact counts for each exceeded limit', () => {
    expect(bioBodyValidationMessage('x'.repeat(301))).toBe('The bio exceeds the limit: 301/300 characters.')
    expect(bioBodyValidationMessage(Array(11).fill('x').join('\n'))).toBe('The bio exceeds the limit: 11/10 lines.')

    const overBothLimits = `${'x'.repeat(290)}\n${Array(10).fill('x').join('\n')}`
    expect(bioBodyValidationMessage(overBothLimits)).toBe(
      'The bio exceeds the limit: 310/300 characters and 11/10 lines.',
    )
  })
})
