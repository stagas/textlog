import type { User } from '../types'
import { EmailSubscriptionPreferences } from './email-subscription-preferences'

export function InteractedEmails({ user, subscribed, token, changed = false, invalid = false }: {
  user?: User | null
  subscribed: boolean
  token?: string
  changed?: boolean
  invalid?: boolean
}) {
  return <EmailSubscriptionPreferences user={user} subscribed={subscribed} token={token} changed={changed}
    invalid={invalid} pageTitle="interaction emails" heading="Interaction emails"
    formAction="/account/interacted-emails"
    subscribedCopy="You are currently subscribed to emails when people interact with you on textlog."
    unsubscribedCopy="You are currently unsubscribed and will not receive interaction emails." />
}
