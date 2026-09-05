import type { User } from '../types'
import { Layout } from './layout'
import { CenteredPanel } from './panel'

export function NavigationCaptcha({ user, target, captcha, error }: {
  user: User | null
  target: string
  captcha: { token: string; image: string }
  error?: string
}) {
  return (
    <Layout title="security check" user={user}>
      <CenteredPanel shellClassName="auth-shell" className="auth-panel password-panel">
        <h1>Security check</h1>
        <p>It looks like you might be a bot, pass this challenge to prove you're human</p>
        {error && <p className="status-message status-error" role="alert">{error}</p>}
        <form method="post" action="/navigation-check">
          <input type="hidden" name="target" value={target} />
          <div className="captcha-field">
            <label htmlFor="navigation-captcha">
              <span>security check</span>
            </label>
            <img src={captcha.image} alt="CAPTCHA: enter the characters shown" />
            <input type="hidden" name="captchaToken" value={captcha.token} />
            <input id="navigation-captcha" name="captchaAnswer" required maxLength={12} autoComplete="off"
              autoCapitalize="none" spellcheck={false} inputMode="text" enterkeyhint="go" autoFocus />
          </div>
          <button className="button">
            continue <span aria-hidden="true">→</span>
          </button>
        </form>
      </CenteredPanel>
    </Layout>
  )
}
