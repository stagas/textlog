import { Layout } from './layout'

export function ConfirmEmail({ token, kind, email, invalid = false, pending = false, sent = false, error }: {
  token?: string
  kind?: 'verify' | 'change'
  email?: string
  invalid?: boolean
  pending?: boolean
  sent?: boolean
  error?: string
}) {
  const allowDevelopmentVerification = Bun.env.NODE_ENV === 'development' || Bun.env.DEV_RELOAD === 'true'
  return (
    <Layout title="confirm email" logoutNavigation={pending}>
      <div className={pending ? 'welcome-panel verify-email-panel' : 'panel confirm-delete'}>
        {pending
          ? (
            <>
              <p className="eyebrow">one last step</p>
              <h1>Verify your email.</h1>
              <p className="verify-email-copy">
                We sent a link to <strong>{email}</strong>. Open it to finish setting up your account.
              </p>
              {sent && (
                <p className="success verify-email-notice" role="status">A fresh verification link has been sent.</p>
              )}
              {error && <p className="error verify-email-notice" role="alert">{error}</p>}
              <div className="welcome-actions verify-email-actions">
                <form method="post" action="/account/email/verify">
                  <button className="button">send another link</button>
                </form>
                {allowDevelopmentVerification && (
                  <form method="post" action="/verify-email/dev">
                    <button className="quiet">verify now</button>
                  </form>
                )}
              </div>
            </>
          )
          : invalid
          ? (
            <>
              <h1>Link unavailable</h1>
              <p>This confirmation link is invalid, expired, or has already been used.</p>
              <a className="button" href="/account/security">account security</a>
            </>
          )
          : (
            <>
              <h1>{kind === 'change' ? 'Change your email?' : 'Verify your email?'}</h1>
              <p>
                {kind === 'change'
                  ? (
                    <>
                      Confirm changing your root.mx account email to <strong>{email}</strong>.
                    </>
                  )
                  : (
                    <>
                      Confirm <strong>{email}</strong> as your root.mx account email.
                    </>
                  )}
              </p>
              <form method="post" action="/verify-email">
                <input type="hidden" name="token" value={token} />
                <div className="form-actions">
                  <a className="quiet" href="/">cancel</a>
                  <button className="button">{kind === 'change' ? 'change email' : 'verify email'}</button>
                </div>
              </form>
            </>
          )}
      </div>
    </Layout>
  )
}
