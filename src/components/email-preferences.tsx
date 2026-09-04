import type { User } from '../types'
import { AccountSettingsHeader, PageHeading } from './account-settings-header'
import { Layout } from './layout'

export function EmailPreferences({ user, recap, interactions, token, returnPath, changed = false, invalid = false }: {
  user?: User | null
  recap: boolean
  interactions: boolean
  token?: string
  returnPath?: string
  changed?: boolean
  invalid?: boolean
}) {
  const backHref = `/account/edit${returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''}#email-preferences`
  return (
    <Layout user={user} title="email preferences">
      <article className="static-page notifications-page">
        {user
          ? <AccountSettingsHeader title="emails" returnPath={returnPath} anchor="email-preferences" />
          : <PageHeading eyebrow="email preferences" title="message preferences" />}
        {invalid
          ? <p className="status-message status-error" role="alert">This email preferences link is unavailable.</p>
          : (
            <>
              {changed && (
                <p className="status-message status-success" role="status">Your email preferences have been saved.</p>
              )}
              <p>Choose which emails you&apos;ll receive.</p>
              <form method="post" action="/account/email-preferences">
                {token && <input type="hidden" name="token" value={token} />}
                {user && <input type="hidden" name="back" value={backHref} />}
                <fieldset className="notification-preferences">
                  <legend>email me about</legend>
                  <label className="notification-toggle">
                    <span>
                      <strong>recaps</strong>
                      <small>Occasional updates about new features and popular notes</small>
                    </span>
                    <input type="checkbox" name="recap" value="1" defaultChecked={recap} />
                    <span className="notification-toggle-track" aria-hidden="true"><span /></span>
                  </label>
                  <label className="notification-toggle">
                    <span>
                      <strong>interactions</strong>
                      <small>When people have interacted with you.</small>
                    </span>
                    <input type="checkbox" name="interactions" value="1" defaultChecked={interactions} />
                    <span className="notification-toggle-track" aria-hidden="true"><span /></span>
                  </label>
                </fieldset>
                <div className="composefoot"><button className="button">save preferences</button></div>
              </form>
            </>
          )}
      </article>
    </Layout>
  )
}
