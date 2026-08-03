import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function Auth(
  { mode, error, success, handle = '', email = '', next }: { mode: 'login' | 'signup'; error?: string; success?: string;
    handle?: string; email?: string; next?: string },
) {
  return (
    <Layout title={mode === 'login' ? 'log in' : 'sign up'}>
      <div className="panel auth">
        <form method="post" action={'/' + mode}>
          {next && <input type="hidden" name="next" value={next} />}
          <FormMessage error={error} success={success} />
          {mode === 'signup' && (
            <label>
              email<input type="email" name="email" required maxLength={254} autoComplete="email" autoFocus
                defaultValue={email} placeholder="you@example.com" />
            </label>
          )}
          <label>
            {mode === 'login' ? 'email or handle' : 'handle'}
            <input name="handle" required pattern={mode === 'signup' ? '[A-Za-z0-9_]{2,24}' : undefined}
              maxLength={mode === 'login' ? 254 : undefined} autoComplete="username" autoFocus={mode === 'login'}
              defaultValue={handle} placeholder={mode === 'login' ? 'you@example.com or your_handle' : 'your_handle'} />
          </label>
          <label>
            password<input type="password" name="password" required minLength={8} placeholder="8+ characters" />
          </label>
          <button className="button wide">{mode === 'signup' ? 'create account →' : 'log in →'}</button>
        </form>
        <p className="switch">
          {mode === 'signup'
            ? (
              <>
                Already here? <a href="/login">Log in</a>
              </>
            )
            : (
              <>
                New here? <a href="/signup">Create an account</a> · <a href="/forgot-password">Forgot password?</a>
              </>
            )}
        </p>
      </div>
    </Layout>
  )
}
