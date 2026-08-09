import { describe, expect, test } from 'bun:test'
import { containsAsciiArt, extractHashtags, extractMentions } from './content'

describe('content metadata extraction', () => {
  test('recognizes the same explicit ASCII-art tags used by every post renderer', () => {
    expect(containsAsciiArt('hello #ascii')).toBe(true)
    expect(containsAsciiArt('hello #ASCII_ART')).toBe(true)
    expect(containsAsciiArt('hello #asciiartist')).toBe(false)
  })
  test('normalizes and deduplicates hashtags', () => {
    expect(extractHashtags('#Build something #build #Notes')).toEqual(['build', 'notes'])
  })

  test('normalizes and deduplicates valid mentions', () => {
    expect(extractMentions('Hello @Demo_01 and @demo_01, meet @reader.')).toEqual(['demo_01', 'reader'])
  })

  test('ignores email fragments and invalid handle lengths', () => {
    expect(extractMentions('mail@example.com @a @abcdefghijklmnopqrstuvwxy')).toEqual([])
  })
})
