import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function ForgotPassword({ sent = false, error }: { sent?: boolean; error?: string }) {
  return (
    <Layout title="forgot password">
      <section className="auth-shell">
        <div className="panel auth-panel password-panel">
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
                <form method="post" action="/forgot-password">
                  <FormMessage error={error} />
                  <label>
                    email<input type="email" name="email" required maxLength={254} autoComplete="email" autoFocus
                      inputMode="email" enterKeyHint="send" placeholder="you@example.com" />
                  </label>
                  <button className="button button-wide">send reset link →</button>
                </form>
                <p className="switch">
                  <a href="/enter" rel="nofollow">Back to login</a>
                </p>
              </>
            )}
        </div>
      </section>
    </Layout>
  )
}
