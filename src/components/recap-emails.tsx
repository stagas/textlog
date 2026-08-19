import type { User } from '../types'
import { Layout } from './layout'
import { Panel } from './panel'

export function RecapEmails({ user, subscribed, token, changed = false, invalid = false }: {
  user?: User | null
  subscribed: boolean
  token?: string
  changed?: boolean
  invalid?: boolean
}) {
  return (
    <Layout user={user} title="recap emails">
      <Panel width="medium" className="recap-emails-panel">
        <p className="eyebrow">email preferences</p>
        <h1>Recap emails</h1>
        {invalid
          ? <p className="status-message status-error" role="alert">This unsubscribe link is unavailable.</p>
          : (
            <>
              {changed && (
                <p className="status-message status-success" role="status">
                  You have been {subscribed ? 'subscribed' : 'unsubscribed'}.
                </p>
              )}
              <p>
                {subscribed
                  ? 'You receive occasional emails about new features and popular notes.'
                  : 'You are not subscribed to recap emails.'}
              </p>
              <form method="post" action="/account/recap-emails">
                {token && <input type="hidden" name="token" value={token} />}
                <input type="hidden" name="subscribed" value={subscribed ? '0' : '1'} />
                <button className="button">{subscribed ? 'unsubscribe' : 'subscribe'}</button>
              </form>
            </>
          )}
        {user && (
          <p>
            <a href="/account/edit">back to account</a>
          </p>
        )}
      </Panel>
    </Layout>
  )
}
