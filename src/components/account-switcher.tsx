import type { AccountChoice } from '../account-groups'
import type { User } from '../types'
import { AccountSettingsHeader } from './account-settings-header'
import { maskEmail } from './email-address'
import { Layout } from './layout'
import { FormMessage } from './page-shared'
import { Panel } from './panel'

export function AccountSwitcher({ user, accounts, error }: { user: User; accounts: AccountChoice[]; error?: string }) {
  return (
    <Layout user={user} title="switch account">
      <Panel as="section" width="fluid" className="account-switcher-page">
        <AccountSettingsHeader title="accounts" />
        <p className="account-switcher-intro">
          Each account has its own profile, notes, connections, settings, and API keys. They share{' '}
          {maskEmail(user.email)}.
        </p>
        <FormMessage error={error} />
        <div className="account-choice-list" role="list">
          {accounts.map(account => {
            const current = account.id === user.id
            return (
              <div className="account-choice" role="listitem" key={account.id}>
                <div>
                  <a href={`/u/${account.handle}`} className="account-choice-handle">@{account.handle}</a>
                  <span className="account-choice-labels">
                    {account.primary && <span>primary</span>}
                    {account.selected && !current && <span>selected for email login</span>}
                    {current && <span>current</span>}
                  </span>
                </div>
                {current
                  ? <span className="account-choice-current">using now</span>
                  : (
                    <form method="post" action="/account/accounts/select">
                      <input type="hidden" name="accountId" value={account.id} />
                      <button className="button">switch</button>
                    </form>
                  )}
              </div>
            )
          })}
        </div>
        <div className="account-create-persona">
          <div>
            <strong>Create a new account</strong>
            <span>Start another full profile under the same email address. You can create up to two per month.</span>
          </div>
          <form method="post" action="/account/accounts/new">
            <button className="button">create new</button>
          </form>
        </div>
      </Panel>
    </Layout>
  )
}
