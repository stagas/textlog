import { Layout } from './layout'

export function Auth({ error, email = '', next }: { error?: string; email?: string; next?: string }) {
  return (
    <Layout title="enter">
      <section className="auth-shell enter-shell">
        <div className="panel auth-panel enter-panel">
          {error && <p className="error" role="alert">{error}</p>}
          <form method="post" action="/enter" autoComplete="on">
            {next && <input type="hidden" name="next" value={next} />}
            <label htmlFor="enter-email">
              <span>email address</span>
            </label>
            <input id="enter-email" type="email" name="email" required maxLength={254} autoComplete="email" autoFocus
              autoCapitalize="none" spellCheck={false} defaultValue={email} placeholder="you@example.com" />
            <button className="button">
              send magic link <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="auth-legal">
            The link expires in one hour. By entering, you agree to the <a href="/legal#terms">Terms of Service</a> and
            {' '}
            <a href="/legal#privacy">Privacy Notice</a>.
          </p>
          <p className="auth-alternative">
            Alternatively, <a href={`/enter/password${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
              log in using your password
            </a>.
          </p>
        </div>
      </section>
    </Layout>
  )
}

export function PasswordLogin({ error, identifier = '', next, reset = false }: {
  error?: string; identifier?: string; next?: string; reset?: boolean
}) {
  return (
    <Layout title="password login">
      <section className="auth-shell">
        <div className="panel auth-panel password-panel">
          <h1>Log in</h1>
          {reset && <p className="success" role="status">Password reset. You can log in now.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <form method="post" action="/enter/password" autoComplete="on">
            {next && <input type="hidden" name="next" value={next} />}
            <label htmlFor="login-identifier"><span>email or handle</span></label>
            <input id="login-identifier" name="identifier" required maxLength={254} autoComplete="username"
              autoCapitalize="none" spellCheck={false} autoFocus defaultValue={identifier} />
            <label htmlFor="login-password"><span>password</span></label>
            <input id="login-password" type="password" name="password" required maxLength={128}
              autoComplete="current-password" />
            <button className="button">log in <span aria-hidden="true">→</span></button>
          </form>
          <p className="auth-secondary"><a href="/forgot-password">Forgot password?</a></p>
          <p className="auth-secondary"><a href="/enter">Use a magic link instead</a></p>
        </div>
      </section>
    </Layout>
  )
}

export function MagicLinkSent({ email, magicUrl }: { email: string; magicUrl?: string }) {
  return (
    <Layout title="check your email">
      <section className="auth-shell">
        <div className="panel auth-panel magic-sent-panel">
          <h1>Check your email</h1>
          <p>
            We’ve sent an entry link to <strong>{email}</strong>.
          </p>
          <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
          {magicUrl && (
            <p>
              <a className="button" href={magicUrl}>open development magic link</a>
            </p>
          )}
        </div>
      </section>
    </Layout>
  )
}

export function ChooseHandle({ error, handle = '', next }: { error?: string; handle?: string; next?: string }) {
  return (
    <Layout title="choose your handle" logoutNavigation>
      <section className="auth-shell">
        <div className="panel auth-panel choose-handle-panel">
          <h1>Choose your handle</h1>
          <p>Pick the handle that people will see.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <form method="post" action="/choose-handle">
            {next && <input type="hidden" name="next" value={next} />}
            <input name="handle" aria-label="handle" required pattern="[A-Za-z0-9_]{2,24}" autoFocus
              defaultValue={handle} placeholder="your_handle" />
            <button className="button">continue</button>
          </form>
        </div>
      </section>
    </Layout>
  )
}
