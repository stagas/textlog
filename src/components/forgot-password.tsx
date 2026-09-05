import { AuthBrand } from './auth'
import { Layout } from './layout'
import { FormMessage } from './page-shared'
import { CenteredPanel } from './panel'

export function ForgotPassword({ sent = false, error, identifier = '' }: {
  sent?: boolean
  error?: string
  identifier?: string
}) {
  return (
    <Layout title="forgot password" fullScreen fullScreenScrollable>
      <CenteredPanel shellClassName="auth-shell enter-shell" className="auth-panel enter-panel password-panel">
        <AuthBrand />
        {sent
          ? (
            <>
              <h1>Check your email</h1>
              <p className="switch">
                If an account uses that address, a password reset link is on its way. It expires in one hour.
              </p>
              <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            </>
          )
          : (
            <>
              <h1>Reset your password</h1>
              <p className="forgot-password-copy">
                Enter your email address or your handle and we’ll send you a secure reset link.
              </p>
              <form method="post" action="/forgot-password">
                <FormMessage error={error} />
                <label htmlFor="forgot-password-identifier">
                  <span>email address or handle</span>
                </label>
                <input id="forgot-password-identifier" name="identifier" required maxLength={254}
                  autoComplete="username" autoFocus inputMode="email" enterkeyhint="send" autoCapitalize="none"
                  spellcheck={false} defaultValue={identifier} placeholder="you@example.com or your_handle" />
                <button className="button button-wide">send reset link →</button>
              </form>
              <p className="switch">
                <a href="/enter" rel="nofollow">back to login</a>
              </p>
            </>
          )}
      </CenteredPanel>
    </Layout>
  )
}
