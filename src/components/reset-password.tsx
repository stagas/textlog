import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function ResetPassword(
  { resetToken, error, invalid = false }: { resetToken?: string; error?: string; invalid?: boolean },
) {
  return (
    <Layout title="reset password">
      <section className="auth-shell">
        <div className="panel auth-panel password-panel">
          {invalid
            ? (
              <>
                <h1>Link unavailable</h1>
                <p className="switch">
                  This reset link is invalid or has expired. <a href="/forgot-password">Request another link</a>.
                </p>
              </>
            )
            : (
              <form method="post" action="/reset-password">
                <FormMessage error={error} />
                <input type="hidden" name="token" value={resetToken} />
                <label>
                  new password<input type="password" name="password" required minLength={8} autoComplete="new-password"
                    placeholder="8+ characters" />
                </label>
                <label>
                  confirm password<input type="password" name="confirmPassword" required minLength={8}
                    autoComplete="new-password" />
                </label>
                <button className="button button-wide">reset password →</button>
              </form>
            )}
        </div>
      </section>
    </Layout>
  )
}
