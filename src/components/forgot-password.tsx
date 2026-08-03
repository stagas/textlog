import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function ForgotPassword({ sent = false, error }: { sent?: boolean; error?: string }) {
  return (
    <Layout title="forgot password">
      <div className="panel auth">
        {sent
          ? (
            <>
              <h1>Check your email</h1>
              <p className="switch">
                If an account uses that address, a password reset link is on its way. It expires in one hour.
              </p>
            </>
          )
          : (
            <>
              <form method="post" action="/forgot-password">
                <FormMessage error={error} />
                <label>
                  email<input type="email" name="email" required maxLength={254} autoComplete="email"
                    placeholder="you@example.com" />
                </label>
                <button className="button wide">send reset link →</button>
              </form>
              <p className="switch">
                <a href="/login">Back to login</a>
              </p>
            </>
          )}
      </div>
    </Layout>
  )
}
