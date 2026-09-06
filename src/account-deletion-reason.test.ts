import { expect, test } from 'bun:test'
import { accountDeletionReason } from './account-deletion'

test('account deletion reasons preserve optional details for every selection', () => {
  expect(accountDeletionReason('missing_features', '  Something specific  '))
    .toBe('It’s missing features I need: Something specific')
  expect(accountDeletionReason('other', '')).toBe('Other')
  expect(accountDeletionReason('other', 'A different reason')).toBe('A different reason')
  expect(accountDeletionReason('', 'detail without a selection')).toBeNull()
})
