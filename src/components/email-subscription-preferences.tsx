import type { User } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { CenteredPanel, PanelCopy, PanelHeading } from './panel'

export type EmailSubscriptionPreferencesProps = {
  user?: User | null
  subscribed: boolean
  token?: string
  changed?: boolean
  invalid?: boolean
  pageTitle: string
  heading: string
  subscribedCopy: string
  unsubscribedCopy: string
  formAction: string
}

export function EmailSubscriptionPreferences({ user, subscribed, token, changed = false, invalid = false,
  pageTitle, heading, subscribedCopy, unsubscribedCopy, formAction }: EmailSubscriptionPreferencesProps) {
  return (
    <Layout user={user} title={pageTitle}>
      <CenteredPanel width="medium" shellClassName="recap-emails-shell" className="recap-emails-panel">
        <p className="eyebrow">email preferences</p>
        <PanelHeading as="h1">{heading}</PanelHeading>
        {invalid
          ? <FormMessage error="This unsubscribe link is unavailable." dismissible={false} />
          : (
            <>
              {changed && <FormMessage success={`You have been ${subscribed ? 'subscribed' : 'unsubscribed'}.`} />}
              <PanelCopy>{subscribed ? subscribedCopy : unsubscribedCopy}</PanelCopy>
              <form method="post" action={formAction}>
                {token && <input type="hidden" name="token" value={token} />}
                <input type="hidden" name="subscribed" value={subscribed ? '0' : '1'} />
                <FormActions
                  secondary={user && <a className="secondary-action" href="/account/edit">back to account</a>}
                  primary={<button className="button">{subscribed ? 'unsubscribe' : 'subscribe'}</button>}
                />
              </form>
            </>
          )}
        {invalid && user && <a className="secondary-action" href="/account/edit">back to account</a>}
      </CenteredPanel>
    </Layout>
  )
}
