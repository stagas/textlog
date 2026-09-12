import { expect, test } from 'bun:test'
import { InteractedEmails } from './components/interacted-emails'
import { RecapEmails } from './components/recap-emails'
import { renderToStaticMarkup } from './render'

const user = { id: 1, handle: 'reader', email: 'reader@example.com', bio: '' }

test('email subscription pages retain their distinct copy and endpoints', () => {
  const recap = renderToStaticMarkup(<RecapEmails subscribed token="recap-token" changed />)
  const interacted = renderToStaticMarkup(<InteractedEmails subscribed={false} token="interaction-token" changed />)

  expect(recap).toContain('<h1 class="panel-heading">Recap emails</h1>')
  expect(recap).toContain('occasional emails about new features and popular notes')
  expect(recap).toContain('action="/account/recap-emails"')
  expect(recap).toContain('name="token" value="recap-token"')
  expect(recap).toContain('name="subscribed" value="0"')
  expect(recap).toContain('You have been subscribed.')
  expect(recap).toContain('>unsubscribe</button>')

  expect(interacted).toContain('<h1 class="panel-heading">Interaction emails</h1>')
  expect(interacted).toContain('will not receive interaction emails')
  expect(interacted).toContain('action="/account/interacted-emails"')
  expect(interacted).toContain('name="token" value="interaction-token"')
  expect(interacted).toContain('name="subscribed" value="1"')
  expect(interacted).toContain('You have been unsubscribed.')
  expect(interacted).toContain('>subscribe</button>')
})

test('email subscription invalid and account-navigation states are preserved', () => {
  const invalidGuest = renderToStaticMarkup(<RecapEmails subscribed={false} invalid />)
  const invalidUser = renderToStaticMarkup(<InteractedEmails user={user} subscribed invalid />)
  const validUser = renderToStaticMarkup(<RecapEmails user={user} subscribed />)

  expect(invalidGuest).toContain('class="status-message status-error" role="alert"')
  expect(invalidGuest).toContain('This unsubscribe link is unavailable.')
  expect(invalidGuest).not.toContain('action="/account/recap-emails"')
  expect(invalidGuest).not.toContain('back to account')
  expect(invalidGuest).not.toContain('status-message-dismiss')

  expect(invalidUser).toContain('back to account')
  expect(invalidUser).not.toContain('action="/account/interacted-emails"')
  expect(validUser).toContain('<a class="secondary-action" href="/account/edit">back to account</a>')
})
