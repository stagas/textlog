import type { User } from '../db'
import { FONT_CHOICES, FONT_SIZE_CHOICES, type FontChoice, type FontSizeChoice } from '../theme'
import { Layout } from './layout'

export function ChangeFont(
  { user, selected, selectedSize = 'regular', returnPath }: { user: User; selected: FontChoice;
    selectedSize?: FontSizeChoice; returnPath?: string },
) {
  const backHref = returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'
  return (
    <Layout user={user} title="change font">
      <section className="appearance-page">
        <div className="appearance-heading">
          <div>
            <span className="eyebrow">appearance</span>
            <h1>change font</h1>
          </div>
          <a className="profile-edit-link" href={backHref}>back</a>
        </div>
        <form method="post" action="/account/edit/font">
          {returnPath && <input type="hidden" name="from" value={returnPath} />}
          <fieldset>
            <legend>local monospace fonts</legend>
            <div className="font-options">
              {FONT_CHOICES.map(font => (
                <label key={font.value} className={`font-option font-preview-${font.value}`}>
                  <input type="radio" name="font" value={font.value} defaultChecked={selected === font.value} />
                  <span className="font-sample">textlog</span>
                  <span>{font.label}</span>
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
                  <span>textlog</span>
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="font-note">
            Fonts are used from your device. If one is not installed, your system monospace font is shown.
          </p>
          <button className="button">save font →</button>
        </form>
      </section>
    </Layout>
  )
}
