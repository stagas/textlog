import { Layout } from './layout'

export function ConfirmEmail({ token, kind, email, invalid = false }: {
  token?: string
  kind?: 'verify' | 'change'
  email?: string
  invalid?: boolean
}) {
  return (
    <Layout title="confirm email">
      <div className="panel confirm-delete">
        {invalid
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
                  ? <>Confirm changing your root.mx account email to <strong>{email}</strong>.</>
                  : <>Confirm <strong>{email}</strong> as your root.mx account email.</>}
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
