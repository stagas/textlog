import { Layout } from './layout'
import { FormActions } from './page-shared'

export function ConfirmEmail({ token, kind, email, invalid = false, pending = false, sent = false, error }: {
  token?: string
  kind?: 'verify' | 'change' | 'authorize-change'
  email?: string
  invalid?: boolean
  pending?: boolean
  sent?: boolean
  error?: string
}) {
  const allowDevelopmentVerification = Bun.env.NODE_ENV === 'development' || Bun.env.DEV_RELOAD === 'true'
  const authorizingChange = kind === 'authorize-change'
  return (
    <Layout title="confirm email" logoutNavigation={pending}>
      <div className={pending || authorizingChange
        ? `welcome-panel verify-email-panel${authorizingChange ? ' email-change-approval' : ''}`
        : 'panel confirm-delete'}
      >
        {pending
          ? (
            <>
              <p className="eyebrow">one last step</p>
              <h1>Verify your email.</h1>
              <p className="verify-email-copy">
                We sent a link to <strong>{email}</strong>. Open it to finish setting up your account.
              </p>
              {sent && (
                <p className="status-message status-success verify-email-notice" role="status">
                  A fresh verification link has been sent.
                </p>
              )}
              {error && <p className="status-message status-error verify-email-notice" role="alert">{error}</p>}
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
              {authorizingChange && <p className="eyebrow">security confirmation</p>}
              <h1>
                {kind === 'authorize-change'
                  ? 'Approve this email change?'
                  : kind === 'change'
                  ? 'Change your email?'
                  : 'Verify your email?'}
              </h1>
              <p>
                {kind === 'authorize-change'
                  ? (
                    <>
                      Allow your textlog account email to be changed to <strong>{email}</strong>.
                    </>
                  )
                  : kind === 'change'
                  ? (
                    <>
                      Confirm changing your textlog account email to <strong>{email}</strong>.
                    </>
                  )
                  : (
                    <>
                      Confirm <strong>{email}</strong> as your textlog account email.
                    </>
                  )}
              </p>
              {error && <p className="status-message status-error" role="alert">{error}</p>}
              <form method="post" action={kind === 'authorize-change'
                ? '/account/email/change/authorize'
                : '/verify-email'}
              >
                <input type="hidden" name="token" value={token} />
                <FormActions secondary={<a className="secondary-action" href="/">cancel</a>}
                  primary={
                    <button className="button">
                      {kind === 'authorize-change'
                        ? 'approve change'
                        : kind === 'change'
                        ? 'change email'
                        : 'verify email'}
                    </button>
                  } />
              </form>
            </>
          )}
      </div>
    </Layout>
  )
}
