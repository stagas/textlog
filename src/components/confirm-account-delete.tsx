import type { User } from '../types'
import { maskEmail } from './email-address'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { CenteredPanel, Panel } from './panel'

export function ConfirmAccountDelete({ user, handle, passwordEnabled = false, token, confirmationUrl, sent = false,
  invalid = false, error }: {
  user?: User | null
  handle?: string
  passwordEnabled?: boolean
  token?: string
  confirmationUrl?: string
  sent?: boolean
  invalid?: boolean
  error?: string
}) {
  const emailConfirmation = !!token
  const accountHandle = handle || user?.handle
  const handleLabel = accountHandle ? `@${accountHandle}` : 'your account'
  return (
    <Layout user={user} title="delete account">
      {sent
        ? (
          <Panel as="section" width="wide" className="welcome-panel verify-email-panel account-delete-sent"
            role="status"
          >
            <p className="eyebrow">confirmation required</p>
            <h1>Check your email to delete {handleLabel}.</h1>
            <p className="verify-email-copy">
              We sent a confirmation link to{' '}
              <strong>{user?.email && maskEmail(user.email)}</strong>. <strong>{handleLabel}</strong> has not been
              deleted.
            </p>
            <p className="account-delete-expiry">
              The link expires in one hour. Open it to review and confirm deletion.
            </p>
            <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            <div className="welcome-actions verify-email-actions">
              <a className="button" href="/account/edit">back to account</a>
              {confirmationUrl && (
                <a className="button" href={confirmationUrl}>open development confirmation link</a>
              )}
            </div>
          </Panel>
        )
        : (
          <CenteredPanel shellClassName="auth-shell account-delete-shell" className="auth-panel account-delete-panel"
            width="medium" tone="danger"
          >
            <p className="eyebrow">account deletion</p>
            <h1>{invalid ? 'Link unavailable.' : `Delete ${handleLabel}?`}</h1>
            {invalid
              ? <p className="account-delete-copy">This confirmation link is invalid, expired, or already used.</p>
              : (
                <p className="account-delete-copy">
                  This cannot be undone. Your profile and account data will be removed. Your notes will remain only as
                  “(deleted post)” tombstones so conversations stay readable.
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
                      We’ll email you a secure confirmation link before {handleLabel} is deleted.
                    </p>
                  )}
                  <FormActions
                    secondary={
                      <a className="secondary-action cancel-action" href={user ? '/account/edit' : '/'}>cancel</a>
                    }
                    primary={
                      <button className="button button-danger" type="submit">
                        {emailConfirmation || passwordEnabled
                          ? `delete ${handleLabel}`
                          : 'send confirmation link →'}
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
