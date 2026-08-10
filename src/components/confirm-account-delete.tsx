import { type User } from '../db'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

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
          <section className="welcome-panel verify-email-panel account-delete-sent" role="status">
            <p className="eyebrow">confirmation required</p>
            <h1>Check your email.</h1>
            <p className="verify-email-copy">
              We sent a confirmation link to <strong>{user?.email}</strong>. Your account has not been deleted.
            </p>
            <p className="account-delete-expiry">The link expires in one hour. Open it to review and confirm deletion.</p>
            <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            <div className="welcome-actions verify-email-actions">
              <a className="button" href="/account/edit">back to account</a>
            </div>
          </section>
        )
        : (
          <section className="auth-shell account-delete-shell"><div className="panel auth-panel account-delete-panel">
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
                      <input type="password" name="password" autoComplete="current-password" required autoFocus />
                    </label>
                  )}
                  {!passwordEnabled && !emailConfirmation && (
                    <p className="account-delete-confirmation-note">
                      We’ll email you a secure confirmation link before anything is deleted.
                    </p>
                  )}
                  <div className="form-actions">
                    <a className="quiet" href={user ? '/account/edit' : '/'}>cancel</a>
                    <button className={`button${emailConfirmation || passwordEnabled ? ' delete-button' : ''}`}
                      type="submit">
                      {emailConfirmation || passwordEnabled ? 'delete account' : 'send confirmation link →'}
                    </button>
                  </div>
                </form>
              )}
          </div></section>
        )}
    </Layout>
  )
}
