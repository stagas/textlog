import { expect, test } from 'bun:test'
import { interactedEmail } from './interacted-email'

test('interaction email links to unread activity and its own unsubscribe preference', () => {
  const html = interactedEmail('https://preview.textlog.test/interacted-email', 'recipient-token')

  expect(html).toStartWith('<!doctype html>')
  expect(html).toContain('People have interacted with you.')
  expect(html).toContain('Someone replied to one of your notes.')
  expect(html).toContain('/@"')
  expect(html).toContain('>Go check it out →</a>')
  expect(html).toContain('/account/interacted-emails/unsubscribe?token=recipient-token')
  expect(html).toContain('>Unsubscribe from interaction emails</a>')
})
