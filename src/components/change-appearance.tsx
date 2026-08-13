import type { User } from '../db'
import { ACCENT_CHOICES, type Appearance, FONT_CHOICES, FONT_SIZE_CHOICES, type FontChoice,
  type FontSizeChoice, THEME_CHOICES } from '../theme'
import { Layout } from './layout'

export type AppearanceTab = 'theme' | 'font'

export function ChangeAppearance({ user, selected, selectedFont, selectedSize = 'regular', tab = 'theme', returnPath }:
  { user: User; selected: Appearance; selectedFont: FontChoice; selectedSize?: FontSizeChoice; tab?: AppearanceTab;
    returnPath?: string }) {
  const backHref = returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'
  const fromQuery = returnPath ? `&from=${encodeURIComponent(returnPath)}` : ''
  return (
    <Layout user={user} title="change appearance">
      <section className="appearance-page">
        <div className="appearance-heading">
          <div>
            <span className="eyebrow">account settings</span>
            <h1>change appearance</h1>
          </div>
          <a className="profile-edit-link" href={backHref}>back</a>
        </div>
        <nav className="appearance-tabs" aria-label="Appearance settings">
          <a href={`/account/edit/appearance?tab=theme${fromQuery}`} aria-current={tab === 'theme' ? 'page' : undefined}>
            theme
          </a>
          <a href={`/account/edit/appearance?tab=font${fromQuery}`} aria-current={tab === 'font' ? 'page' : undefined}>
            font
          </a>
        </nav>
        {tab === 'theme' ? (
          <form method="post" action="/account/edit/appearance">
            <input type="hidden" name="tab" value="theme" />
            {returnPath && <input type="hidden" name="from" value={returnPath} />}
            <fieldset>
              <legend>theme</legend>
              <div className="theme-options">
                {THEME_CHOICES.map(theme => (
                  <label key={theme} className={`theme-option theme-preview-${theme}`}>
                    <input type="radio" name="theme" value={theme} defaultChecked={selected.theme === theme} />
                    <span className="theme-preview" aria-hidden="true"><i /><i /><i /></span>
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
                    <span className={`accent-swatch accent-swatch-${accent}${accent === 'theme'
                      ? ` accent-swatch-theme-${selected.theme}` : ''}`} />
                    <span>{accent}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="button">save theme →</button>
          </form>
        ) : (
          <form method="post" action="/account/edit/appearance">
            <input type="hidden" name="tab" value="font" />
            {returnPath && <input type="hidden" name="from" value={returnPath} />}
            <fieldset>
              <legend>local monospace fonts</legend>
              <div className="font-options">
                {FONT_CHOICES.map(font => (
                  <label key={font.value} className={`font-option font-preview-${font.value}`}>
                    <input type="radio" name="font" value={font.value} defaultChecked={selectedFont === font.value} />
                    <span className="font-sample">textlog</span><span>{font.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>font size</legend>
              <div className="font-size-options">
                {FONT_SIZE_CHOICES.map(choice => (
                  <label key={choice.value} className={`font-size-option font-size-${choice.value}`}>
                    <input type="radio" name="fontSize" value={choice.value}
                      defaultChecked={selectedSize === choice.value} />
                    <span>textlog</span><span>{choice.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="font-note">Fonts are used from your device. If one is not installed, your system monospace font is shown.</p>
            <button className="button">save font →</button>
          </form>
        )}
      </section>
    </Layout>
  )
}
