import type { AccountChoice } from '../account-groups'
import type { User } from '../db'
import { AccountSettingsHeader } from './account-settings-header'
import { Layout } from './layout'

export function AccountSwitcher({ user, accounts, error }: { user: User; accounts: AccountChoice[]; error?: string }) {
  return (
    <Layout user={user} title="switch account">
      <section className="panel account-switcher-page">
        <AccountSettingsHeader title="accounts" />
        <p className="account-switcher-intro">
          Each account has its own profile, notes, connections, settings, and API keys. They share {user.email}.
        </p>
        {error && <p className="error">{error}</p>}
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
      </section>
    </Layout>
  )
}
