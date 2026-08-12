import { Layout } from './layout'

export function Auth({ error, email = '', next }: { error?: string; email?: string; next?: string }) {
  return (
    <Layout title="enter">
      <section className="auth-shell enter-shell">
        <div className="panel auth-panel enter-panel">
          {error && <p className="status-message status-error" role="alert">{error}</p>}
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
            The link and code expire in 15 minutes. By entering, you agree to the{' '}
            <a href="/legal#terms">Terms of Service</a> and <a href="/legal#privacy">Privacy Notice</a>.
          </p>
          <p className="auth-alternative">
            Alternatively,{' '}
            <a href={`/enter/password${next ? `?next=${encodeURIComponent(next)}` : ''}`} rel="nofollow">
              log in using your password
            </a>.
          </p>
        </div>
      </section>
    </Layout>
  )
}

export function PasswordLogin({ nonce, error, identifier = '', next, reset = false, captcha }: {
  nonce: string
  error?: string
  identifier?: string
  next?: string
  reset?: boolean
  captcha?: { token: string; image: string }
}) {
  return (
    <Layout title="password login">
      <section className="auth-shell">
        <div className="panel auth-panel password-panel">
          <h1>Log in</h1>
          {reset && <p className="status-message status-success" role="status">Password reset. You can log in now.</p>}
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          <form method="post" action="/enter/password" autoComplete="on">
            <input type="hidden" name="nonce" value={nonce} />
            {next && <input type="hidden" name="next" value={next} />}
            <label htmlFor="login-identifier">
              <span>email or handle</span>
            </label>
            <input id="login-identifier" name="identifier" required maxLength={254} autoComplete="username"
              autoCapitalize="none" spellCheck={false} autoFocus defaultValue={identifier} />
            <label htmlFor="login-password">
              <span>password</span>
            </label>
            <input id="login-password" type="password" name="password" required maxLength={128}
              autoComplete="current-password" />
            {captcha && <div className="captcha-field">
              <label htmlFor="login-captcha"><span>security check</span></label>
              <img src={captcha.image} alt="CAPTCHA: enter the characters shown" />
              <input type="hidden" name="captchaToken" value={captcha.token} />
              <input id="login-captcha" name="captchaAnswer" required maxLength={12} autoComplete="off"
                autoCapitalize="none" spellCheck={false} />
            </div>}
            <button className="button">
              log in <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="auth-secondary">
            <a href="/forgot-password">Forgot password?</a>
          </p>
          <p className="auth-secondary">
            <a href="/enter" rel="nofollow">Use a magic link instead</a>
          </p>
        </div>
      </section>
    </Layout>
  )
}

export function MagicLinkSent({ email, magicUrl, error }: { email: string; magicUrl?: string; error?: string }) {
  return (
    <Layout title="check your email">
      <section className="auth-shell">
        <div className="panel auth-panel magic-sent-panel">
          <h1>Check your email</h1>
          <p>
            We’ve sent an entry link to <strong>{email}</strong>.
          </p>
          <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
          <p className="entry-code-copy">or enter the six-digit code</p>
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          <form method="post" action="/enter/code" autoComplete="one-time-code">
            <input type="hidden" name="email" value={email} />
            <div className="entry-code-row">
              <input id="entry-code" name="code" aria-label="six-digit code" required inputMode="numeric"
                autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
                aria-describedby="entry-code-help" />
              <button className="button">
                enter <span aria-hidden="true">→</span>
              </button>
            </div>
            <p id="entry-code-help" className="auth-secondary entry-code-help">
              The link and code expire in 15 minutes and can only be used once.
            </p>
          </form>
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
          {error && <p className="status-message status-error" role="alert">{error}</p>}
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
