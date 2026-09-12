import type { User } from '../types'
import { EmailSubscriptionPreferences } from './email-subscription-preferences'

export function RecapEmails({ user, subscribed, token, changed = false, invalid = false }: {
  user?: User | null
  subscribed: boolean
  token?: string
  changed?: boolean
  invalid?: boolean
}) {
  return <EmailSubscriptionPreferences user={user} subscribed={subscribed} token={token} changed={changed}
    invalid={invalid} pageTitle="recap emails" heading="Recap emails" formAction="/account/recap-emails"
    subscribedCopy="You are currently subscribed and receiving occasional emails about new features and popular notes."
    unsubscribedCopy="You are currently unsubscribed and will not be receiving recap emails." />
}
