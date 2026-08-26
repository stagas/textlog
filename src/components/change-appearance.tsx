import { DENSITY_CHOICES, type DensityChoice, PAGE_SIZE_CHOICES, type PageSizeChoice } from '../request-preferences'
import { ACCENT_CHOICES, type Appearance, FONT_CHOICES, FONT_SIZE_CHOICES, type FontChoice, type FontSizeChoice,
  PRIMARY_FONT_CHOICES, type PrimaryFontChoice, SANS_SERIF_FONT_CHOICES, type SansSerifFontChoice,
  THEME_CHOICES } from '../theme'
import type { User } from '../types'
import { AccountSettingsHeader } from './account-settings-header'
import { Layout } from './layout'

export type AppearanceTab = 'theme' | 'font' | 'misc'

export function ChangeAppearance(
  { user, selected, selectedFont, selectedSansSerifFont = 'system-sans', selectedPrimaryFont = 'monospace',
    selectedSize = 'regular', selectedPageSize = 20, selectedDensity = 'regular', selectedLinkPreviews = true,
    includePeopleFollowActivity = false, includeHashtagFollowActivity = false,
    tab = 'theme', returnPath }: { user: User; selected: Appearance; selectedFont: FontChoice;
      selectedSansSerifFont?: SansSerifFontChoice; selectedPrimaryFont?: PrimaryFontChoice;
      selectedSize?: FontSizeChoice; tab?: AppearanceTab; selectedPageSize?: PageSizeChoice;
      selectedDensity?: DensityChoice; selectedLinkPreviews?: boolean; returnPath?: string;
      includePeopleFollowActivity?: boolean; includeHashtagFollowActivity?: boolean },
) {
  const fromQuery = returnPath ? `&from=${encodeURIComponent(returnPath)}` : ''
  return (
    <Layout user={user} title="change appearance">
      <section className="appearance-page">
        <AccountSettingsHeader title="appearance" returnPath={returnPath} />
        <nav className="appearance-tabs" aria-label="Appearance settings">
          <a href={`/account/edit/appearance?tab=theme${fromQuery}`}
            aria-current={tab === 'theme' ? 'page' : undefined}
          >
            theme
          </a>
          <a href={`/account/edit/appearance?tab=font${fromQuery}`} aria-current={tab === 'font' ? 'page' : undefined}>
            font
          </a>
          <a href={`/account/edit/appearance?tab=misc${fromQuery}`} aria-current={tab === 'misc' ? 'page' : undefined}>
            misc
          </a>
        </nav>
        {tab === 'theme'
          ? (
            <form method="post" action="/account/edit/appearance">
              <input type="hidden" name="tab" value="theme" />
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
              <button className="button">save theme →</button>
            </form>
          )
          : tab === 'font'
          ? (
            <form method="post" action="/account/edit/appearance">
              <input type="hidden" name="tab" value="font" />
              {returnPath && <input type="hidden" name="from" value={returnPath} />}
              <fieldset>
                <legend>font size</legend>
                <div className="font-size-options">
                  {FONT_SIZE_CHOICES.map(choice => (
                    <label key={choice.value} className={`font-size-option font-size-${choice.value}`}>
                      <input type="radio" name="fontSize" value={choice.value}
                        defaultChecked={selectedSize === choice.value} />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>primary font</legend>
                <div className="font-size-options">
                  {PRIMARY_FONT_CHOICES.map(choice => (
                    <label key={choice} className={`font-size-option primary-font-${choice}`}>
                      <input type="radio" name="primaryFont" value={choice}
                        defaultChecked={selectedPrimaryFont === choice} />
                      <span>{choice}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>monospace fonts</legend>
                <div className="font-options">
                  {FONT_CHOICES.map(font => (
                    <label key={font.value} className={`font-option font-preview-${font.value}`}>
                      <input type="radio" name="font" value={font.value} defaultChecked={selectedFont === font.value} />
                      <span className="font-sample">{font.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>sans serif fonts</legend>
                <div className="font-options">
                  {SANS_SERIF_FONT_CHOICES.map(font => (
                    <label key={font.value} className={`font-option font-preview-${font.value}`}>
                      <input type="radio" name="sansSerifFont" value={font.value}
                        defaultChecked={selectedSansSerifFont === font.value} />
                      <span className="font-sample">{font.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="font-note">
                Fonts are used from your device. Unavailable faces fall back to your system&apos;s fonts.
              </p>
              <button className="button">save font →</button>
            </form>
          )
          : (
            <form method="post" action="/account/edit/appearance">
              <input type="hidden" name="tab" value="misc" />
              {returnPath && <input type="hidden" name="from" value={returnPath} />}
              <fieldset>
                <legend>page size</legend>
                <div className="misc-options">
                  {PAGE_SIZE_CHOICES.map(size => (
                    <label key={size} className="misc-option">
                      <input type="radio" name="pageSize" value={size} defaultChecked={selectedPageSize === size} />
                      <span>{size}</span>
                      <span>notes</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>density</legend>
                <div className="misc-options">
                  {DENSITY_CHOICES.map(density => (
                    <label key={density} className="misc-option density-option">
                      <input type="radio" name="density" value={density} defaultChecked={selectedDensity === density} />
                      <span className={`density-preview density-preview-${density}`} aria-hidden="true">
                        <svg viewBox="0 0 62 36" focusable="false">
                          <rect width="62" height="2" />
                          <rect width="47" height="2" />
                          <rect width="55" height="2" />
                          <rect width="36" height="2" />
                        </svg>
                      </span>
                      <span>{density}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>ui</legend>
                <label className="link-preview-setting">
                  <input className="form-checkbox" type="checkbox" role="switch" name="showLinkPreviews" value="yes"
                    defaultChecked={selectedLinkPreviews} />
                  <span>Show link previews</span>
                </label>
                <label className="link-preview-setting">
                  <input className="form-checkbox" type="checkbox" role="switch" name="includePeopleFollowActivity"
                    value="yes" defaultChecked={includePeopleFollowActivity} />
                  <span>Include people&apos;s follow activity in For You</span>
                </label>
                <label className="link-preview-setting">
                  <input className="form-checkbox" type="checkbox" role="switch"
                    name="includeHashtagFollowActivity" value="yes" defaultChecked={includeHashtagFollowActivity} />
                  <span>Include hashtag follow activity in For You</span>
                </label>
              </fieldset>
              <button className="button">save misc →</button>
            </form>
          )}
      </section>
    </Layout>
  )
}
