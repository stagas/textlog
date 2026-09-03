import { expect, test } from 'bun:test'
import { normalizeWord } from './wordnet'
import { linkify } from './utils'

test('normalizes adjective and adverb forms to their WordNet noun topic', async () => {
  expect(await normalizeWord('philosophical')).toBe('philosophy')
  expect(await normalizeWord('philosophically')).toBe('philosophy')
})

test('leaves words and non-English hashtag text without a noun derivation intact', async () => {
  expect(await normalizeWord('philosophy')).toBe('philosophy')
  expect(await normalizeWord('φιλοσοφία')).toBe('φιλοσοφία')
})

test('uses WordNet-validated noun inflection instead of blindly stripping plural suffixes', async () => {
  expect(await normalizeWord('developers')).toBe('developer')
  expect(await normalizeWord('classes')).toBe('class')
  expect(await normalizeWord('news')).toBe('news')
})

test('rendered hashtags target their canonical WordNet page without a redirect', () => {
  expect(linkify('#philosophically', {}, [], undefined, undefined, '', { philosophically: 1 }, {}, {
    signedIn: false,
    formPrefix: 'wordnet',
    hashtagTargets: { philosophically: 'philosophy' },
  })).toContain('href="/tag/philosophy"')
})
