import type { User } from '../types'
import { Layout } from './layout'
import { maskEmail } from './email-address'
import { CenteredPanel, Panel } from './panel'
import { FormActions, FormMessage } from './page-shared'

export function ConfirmAccountDelete({ user, passwordEnabled = false, token, sent = false, invalid = false, error }: {
  user?: User | null
  passwordEnabled?: boolean
  token?: string
  sent?: boolean
  invalid?: boolean
  error?: string
}) {
  const emailConfirmation = !!token
  return (
    <Layout user={user} title="delete account">
      {sent
        ? (
          <Panel as="section" width="wide" className="welcome-panel verify-email-panel account-delete-sent" role="status">
            <p className="eyebrow">confirmation required</p>
            <h1>Check your email.</h1>
            <p className="verify-email-copy">
              We sent a confirmation link to <strong>{user?.email && maskEmail(user.email)}</strong>. Your account has not been deleted.
            </p>
            <p className="account-delete-expiry">
              The link expires in one hour. Open it to review and confirm deletion.
            </p>
            <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            <div className="welcome-actions verify-email-actions">
              <a className="button" href="/account/edit">back to account</a>
            </div>
          </Panel>
        )
        : (
          <CenteredPanel shellClassName="auth-shell account-delete-shell"
            className="auth-panel account-delete-panel" width="medium" tone="danger">
              <p className="eyebrow">account deletion</p>
              <h1>{invalid ? 'Link unavailable.' : 'Delete your account?'}</h1>
              {invalid
                ? <p className="account-delete-copy">This confirmation link is invalid, expired, or already used.</p>
                : (
                  <p className="account-delete-copy">
                    This cannot be undone. Your profile and account data will be removed. Your notes will remain only as
                    “(deleted)” tombstones so conversations stay readable.
                  </p>
                )}
              {invalid
                ? <a className="button" href={user ? '/account/edit' : '/'}>{user ? 'back to account' : 'go home'}</a>
                : (
                  <form className="account-delete-form" method="post" action="/account/delete">
                    <FormMessage error={error} />
                    {emailConfirmation && <input type="hidden" name="token" value={token} />}
                    {passwordEnabled && !emailConfirmation && (
                      <label>
                        <span>confirm your password</span>
                        <input type="password" name="password" autoComplete="current-password" enterKeyHint="done"
                          required autoFocus />
                      </label>
                    )}
                    {!passwordEnabled && !emailConfirmation && (
                      <p className="account-delete-confirmation-note">
                        We’ll email you a secure confirmation link before anything is deleted.
                      </p>
                    )}
                    <FormActions
                      secondary={<a className="secondary-action cancel-action" href={user ? '/account/edit' : '/'}>cancel</a>}
                      primary={
                        <button className="button button-danger" type="submit">
                          {emailConfirmation || passwordEnabled ? 'delete account' : 'send confirmation link →'}
                        </button>
                      }
                    />
                  </form>
                )}
          </CenteredPanel>
        )}
    </Layout>
  )
}
