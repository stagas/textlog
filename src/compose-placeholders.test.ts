import { expect, test } from 'bun:test'
import { COMPOSE_PLACEHOLDERS, randomComposePlaceholder } from './compose-placeholders'

test('compose offers 30 editable placeholder messages', () => {
  expect(COMPOSE_PLACEHOLDERS).toHaveLength(30)
  expect(randomComposePlaceholder('hande', () => 0)).toBe('What’s on your mind, @hande?')
  expect(randomComposePlaceholder('hande', () => 0.999)).toBe('How’s your day treating you, @hande?')
})
