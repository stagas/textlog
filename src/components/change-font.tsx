import type { User } from '../db'
import { FONT_CHOICES, type FontChoice } from '../theme'
import { Layout } from './layout'

export function ChangeFont({ user, selected }: { user: User; selected: FontChoice }) {
  return (
    <Layout user={user} title="change font">
      <section className="appearance-page">
        <div className="appearance-heading">
          <div><span className="eyebrow">appearance</span><h1>change font</h1></div>
          <a className="quiet" href="/account/edit">back</a>
        </div>
        <form method="post" action="/account/edit/font">
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
          <p className="font-note">Fonts are used from your device. If one is not installed, your system monospace font is shown.</p>
          <button className="button">save font →</button>
        </form>
      </section>
    </Layout>
  )
}
