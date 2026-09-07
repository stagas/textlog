import { expect, test } from 'bun:test'
import { COMPOSE_PLACEHOLDERS, randomComposePlaceholder } from './compose-placeholders'

test('compose picks an editable placeholder and inserts the handle', () => {
  expect(randomComposePlaceholder('hande', () => 0)).toBe('What’s on your mind, @hande?')
  expect(randomComposePlaceholder('hande', () => 0.999)).toBe(
    COMPOSE_PLACEHOLDERS.at(-1)!.replace('{handle}', 'hande'),
  )
})
