import type { User } from '../db'
import { ACCENT_CHOICES, type Appearance, THEME_CHOICES } from '../theme'
import { Layout } from './layout'

export function ChangeTheme({ user, selected, returnPath }: { user: User; selected: Appearance; returnPath?: string }) {
  const backHref = returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'
  return (
    <Layout user={user} title="change theme">
      <section className="appearance-page">
        <div className="appearance-heading">
          <div>
            <span className="eyebrow">appearance</span>
            <h1>change theme</h1>
          </div>
          <a className="profile-edit-link" href={backHref}>back</a>
        </div>
        <form method="post" action="/account/edit/theme">
          {returnPath && <input type="hidden" name="from" value={returnPath} />}
          <fieldset>
            <legend>theme</legend>
            <div className="theme-options">
              {THEME_CHOICES.map(theme => (
                <label key={theme} className={`theme-option theme-preview-${theme}`}>
                  <input type="radio" name="theme" value={theme} defaultChecked={selected.theme === theme} />
                  <span className="theme-preview" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{theme}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>accent</legend>
            <div className="accent-options">
              {ACCENT_CHOICES.map(accent => (
                <label key={accent} className="accent-option">
                  <input type="radio" name="accent" value={accent} defaultChecked={selected.accent === accent} />
                  <span className={`accent-swatch accent-swatch-${accent}${
                    accent === 'theme'
                      ? ` accent-swatch-theme-${selected.theme}`
                      : ''
                  }`} />
                  <span>{accent}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="button">save appearance →</button>
        </form>
      </section>
    </Layout>
  )
}
