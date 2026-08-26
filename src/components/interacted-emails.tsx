import type { User } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { CenteredPanel, PanelCopy, PanelHeading } from './panel'

export function InteractedEmails({ user, subscribed, token, changed = false, invalid = false }: {
  user?: User | null
  subscribed: boolean
  token?: string
  changed?: boolean
  invalid?: boolean
}) {
  return (
    <Layout user={user} title="interaction emails">
      <CenteredPanel width="medium" shellClassName="recap-emails-shell" className="recap-emails-panel">
        <p className="eyebrow">email preferences</p>
        <PanelHeading as="h1">Interaction emails</PanelHeading>
        {invalid
          ? <p className="status-message status-error" role="alert">This unsubscribe link is unavailable.</p>
          : (
            <>
              {changed && (
                <p className="status-message status-success" role="status">
                  You have been {subscribed ? 'subscribed' : 'unsubscribed'}.
                </p>
              )}
              <PanelCopy>
                {subscribed
                  ? 'You are currently subscribed to emails when people interact with you on textlog.'
                  : 'You are currently unsubscribed and will not receive interaction emails.'}
              </PanelCopy>
              <form method="post" action="/account/interacted-emails">
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
