import { describe, expect, test } from 'bun:test'
import { containsAsciiArt, extractHashtags, extractMentions, postContentFlags, splitSpoilerBody } from './content'

describe('content metadata extraction', () => {
  test('classifies the parsers needed to render a post', () => {
    expect(postContentFlags('ordinary text')).toEqual({ has_latex: 0, has_links: 0, has_code: 0 })
    expect(postContentFlags('see example.com and @reader #notes'))
      .toEqual({ has_latex: 0, has_links: 1, has_code: 0 })
    expect(postContentFlags('see &123')).toEqual({ has_latex: 0, has_links: 1, has_code: 0 })
    expect(postContentFlags('see ~123')).toEqual({ has_latex: 0, has_links: 0, has_code: 0 })
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
  test('splits content after the first real spoiler tag line', () => {
    expect(splitSpoilerBody('visible\n#SPOILER\nhidden\nmore')).toEqual({
      visible: 'visible\n#SPOILER',
      hidden: 'hidden\nmore',
    })
    expect(splitSpoilerBody('https://example.com/#spoiler\nvisible')).toEqual({
      visible: 'https://example.com/#spoiler\nvisible',
      hidden: '',
    })
  })
  test('supports spoiler hashtag aliases', () => {
    for (const tag of ['tldr', 'sensitive', 'contentwarning', 'cw', 'triggerwarning']) {
      expect(splitSpoilerBody(`visible\n#${tag}\nhidden`)).toEqual({
        visible: `visible\n#${tag}`,
        hidden: 'hidden',
      })
    }
  })
  test('does not activate spoilers from inside fenced code', () => {
    const body = 'visible\n```text\n#spoiler\n```\nstill visible'
    expect(splitSpoilerBody(body)).toEqual({ visible: body, hidden: '' })
  })
  test('normalizes and deduplicates hashtags', () => {
    expect(extractHashtags('#Build something #build #Notes #ascii_art #asciiart')).toEqual([
      'build', 'notes', 'asciiart',
    ])
  })

  test('preserves distinct meta hashtag aliases', () => {
    expect(extractHashtags('#meta #tlog #textlog')).toEqual(['meta', 'tlog', 'textlog'])
  })

  test('extracts only the first ten hashtag occurrences', () => {
    expect(extractHashtags('#one #two #three #four #five #six #seven #eight #nine #ten #eleven')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
    ])
  })

  test('supports hashtags written in other scripts and with combining marks', () => {
    expect(extractHashtags('#Ελλάδα #日本語 #العَرَبِيَّة #cafe\u0301 #CAFÉ'))
      .toEqual(['ελλάδα', '日本語', 'العَرَبِيَّة', 'café'])
  })

  test('ignores URL fragments in plain and Markdown URLs', () => {
    expect(extractHashtags(
      'https://example.com/docs#plain [guide](https://example.com/docs#markdown) #actual',
    )).toEqual(['actual'])
    expect(extractHashtags('example.com/#fragment #one #two #three #four #five'))
      .toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  test('ignores hashtags in inline code and fenced code blocks', () => {
    expect(extractHashtags('keep #outside but not `#inline` or ``code `#nested` here``'))
      .toEqual(['outside'])
    expect(extractHashtags('before #one\n```ts\nconst tag = "#fenced"\n```\nafter #two'))
      .toEqual(['one', 'two'])
    expect(extractHashtags('~~~\n#tilde_fence\n~~~\n#visible')).toEqual(['visible'])
  })

  test('normalizes and deduplicates valid mentions', () => {
    expect(extractMentions('Hello @Demo_01 and @demo_01, meet @reader.')).toEqual(['demo_01', 'reader'])
  })

  test('ignores email fragments and invalid handle lengths', () => {
    expect(extractMentions('mail@example.com @a @abcdefghijklmnopqrstuvwxy')).toEqual([])
  })
})
