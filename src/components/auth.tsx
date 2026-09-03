import { maskEmail } from './email-address'
import { Layout } from './layout'
import { CenteredPanel } from './panel'
import { appName } from '../brand'
import { activeThemeLogoSvg } from '../theme'

export { maskEmail } from './email-address'

export function AuthBrand() {
  const name = appName()
  const logoSvg = activeThemeLogoSvg()
  return (
    <a className="brand enter-brand" href="/" aria-label={`${name} home`}>
      <span className="brand-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg }} />
      <span>{name}</span>
    </a>
  )
}

export function Auth({ error, email = '', next, returning = false }: {
  error?: string
  email?: string
  next?: string
  returning?: boolean
}) {
  return (
    <Layout title="enter" fullScreen fullScreenScrollable>
      <CenteredPanel shellClassName="auth-shell enter-shell" className="auth-panel enter-panel">
        <AuthBrand />
        <h1>{returning ? 'Welcome back.' : 'New here or returning?'}</h1>
        {error && <p className="status-message status-error" role="alert">{error}</p>}
        <form method="post" action="/enter" autoComplete="on">
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="enter-identifier">
            <span>email address or handle</span>
          </label>
          <input id="enter-identifier" name="identifier" required maxLength={254} autoComplete="username" autoFocus
            autoCapitalize="none" spellCheck={false} inputMode="email" enterKeyHint="send" defaultValue={email}
            placeholder="you@example.com or your_handle" />
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
      </CenteredPanel>
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
    <Layout title="password login" fullScreen fullScreenScrollable>
      <CenteredPanel shellClassName="auth-shell enter-shell" className="auth-panel enter-panel password-panel">
        <AuthBrand />
        <h1>Log in</h1>
        {reset && <p className="status-message status-success" role="status">Password reset. You can log in now.</p>}
        {error && <p className="status-message status-error" role="alert">{error}</p>}
        <form method="post" action="/enter/password" autoComplete="on">
          <input type="hidden" name="nonce" value={nonce} />
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="login-identifier">
            <span>email address or handle</span>
          </label>
          <input id="login-identifier" name="identifier" required maxLength={254} autoComplete="username"
            autoCapitalize="none" spellCheck={false} autoFocus={!error} defaultValue={identifier} inputMode="email"
            enterKeyHint="next" placeholder="you@example.com or your_handle" />
          <label htmlFor="login-password">
            <span>password</span>
          </label>
          <input id="login-password" type="password" name="password" required maxLength={128}
            autoComplete="current-password" enterKeyHint={captcha ? 'next' : 'go'} autoFocus={!!error}
            placeholder="••••••••" />
          {captcha && (
            <div className="captcha-field">
              <label htmlFor="login-captcha">
                <span>security check</span>
              </label>
              <img src={captcha.image} alt="CAPTCHA: enter the characters shown" />
              <input type="hidden" name="captchaToken" value={captcha.token} />
              <input id="login-captcha" name="captchaAnswer" required maxLength={12} autoComplete="off"
                autoCapitalize="none" spellCheck={false} inputMode="text" enterKeyHint="go" />
            </div>
          )}
          <button className="button">
            log in <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="auth-secondary">
          <a href="/forgot-password">forgot password?</a>
        </p>
        <p className="auth-secondary">
          <a href="/enter" rel="nofollow">use a magic link instead</a>
        </p>
      </CenteredPanel>
    </Layout>
  )
}

export function MagicLinkSent({ email, magicUrl, error, handle = false }: {
  email: string
  magicUrl?: string
  error?: string
  handle?: boolean
}) {
  return (
    <Layout title="check your email" fullScreen fullScreenScrollable>
      <CenteredPanel shellClassName="auth-shell enter-shell"
        className="auth-panel enter-panel magic-sent-panel" width="medium">
        <AuthBrand />
        <h1>Check your email</h1>
        <p>
          {handle
            ? (
              <>
                Magic link and code sent to the email of <strong>{email}</strong>.
              </>
            )
            : (
              <>
                Magic link and code sent to <strong>{maskEmail(email)}</strong>.
              </>
            )}
        </p>
        <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
        <p className="entry-code-copy">or enter the six-digit code</p>
        {error && <p className="status-message status-error" role="alert">{error}</p>}
        <form method="post" action="/enter/code" autoComplete="one-time-code">
          <input type="hidden" name="identifier" value={email} />
          <div className="entry-code-row">
            <input id="entry-code" name="code" aria-label="six-digit code" required inputMode="numeric"
              autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
              aria-describedby="entry-code-help" enterKeyHint="go" />
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
      </CenteredPanel>
    </Layout>
  )
}

export function ChooseHandle({ error, handle = '', next }: { error?: string; handle?: string; next?: string }) {
  return (
    <Layout title="choose your handle" fullScreen>
      <section className="handle-picker" aria-labelledby="handle-picker-title">
        <div className="handle-picker-card">
          <h1 id="handle-picker-title">Choose a handle</h1>
          <p>Pick the name people will see.</p>
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          <form method="post" action="/choose-handle">
            {next && <input type="hidden" name="next" value={next} />}
            <input className="form-control" name="handle" aria-label="handle" aria-describedby="handle-help" autoFocus
              autoComplete="username" inputMode="text" enterKeyHint="done" autoCapitalize="none" spellCheck={false}
              defaultValue={handle} placeholder="your_handle" />
            <p id="handle-help" className="form-hint">
              Handles must be 2–24 characters and use only letters, numbers, or underscores. You can change it later.
            </p>
            <button className="button">continue →</button>
          </form>
        </div>
      </section>
    </Layout>
  )
}
