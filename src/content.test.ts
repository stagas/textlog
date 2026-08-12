import { describe, expect, test } from 'bun:test'
import { containsAsciiArt, extractHashtags, extractMentions, postContentFlags } from './content'

describe('content metadata extraction', () => {
  test('classifies the parsers needed to render a post', () => {
    expect(postContentFlags('ordinary text')).toEqual({ has_latex: 0, has_links: 0, has_code: 0 })
    expect(postContentFlags('see example.com and @reader #notes'))
      .toEqual({ has_latex: 0, has_links: 1, has_code: 0 })
    expect(postContentFlags('`const x = 1` and $x^2$'))
      .toEqual({ has_latex: 1, has_links: 0, has_code: 1 })
    expect(postContentFlags('```latex\n\\frac{1}{2}\n```'))
      .toEqual({ has_latex: 1, has_links: 0, has_code: 1 })
  })
  test('recognizes the same explicit ASCII-art tags used by every post renderer', () => {
    expect(containsAsciiArt('hello #ascii')).toBe(true)
    expect(containsAsciiArt('hello #ASCII_ART')).toBe(true)
    expect(containsAsciiArt('hello #asciiartist')).toBe(false)
  })
  test('normalizes and deduplicates hashtags', () => {
    expect(extractHashtags('#Build something #build #Notes')).toEqual(['build', 'notes'])
  })

  test('extracts only the first five hashtag occurrences', () => {
    expect(extractHashtags('#one #two #three #four #five #six')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ])
  })

  test('supports hashtags written in other scripts and with combining marks', () => {
    expect(extractHashtags('#Ελλάδα #日本語 #العَرَبِيَّة #cafe\u0301 #CAFÉ'))
      .toEqual(['ελλάδα', '日本語', 'العَرَبِيَّة', 'café'])
  })

  test('normalizes and deduplicates valid mentions', () => {
    expect(extractMentions('Hello @Demo_01 and @demo_01, meet @reader.')).toEqual(['demo_01', 'reader'])
  })

  test('ignores email fragments and invalid handle lengths', () => {
    expect(extractMentions('mail@example.com @a @abcdefghijklmnopqrstuvwxy')).toEqual([])
  })
})
