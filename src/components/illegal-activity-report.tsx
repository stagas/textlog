import { appName, appOrigin } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { Panel } from './panel'

export function IllegalActivityReport(
  { user, error, reference, values = {} }: { user: User | null; error?: string; reference?: string;
    values?: Record<string, string> },
) {
  const name = appName()
  const origin = appOrigin() || 'http://localhost:3000'
  return (
    <Layout user={user} title="report illegal activity">
      <article className="static-page illegal-activity-page">
        <p className="eyebrow">safety</p>
        <h1>Report illegal activity</h1>
        {reference
          ? (
            <p className="status-message status-success" role="status">
              Your report was received. Reference: <strong>{reference}</strong>.
            </p>
          )
          : (
            <>
              <p>Use this form to report a specific {name} post that you believe involves illegal activity.</p>
              <Panel as="form" width="fluid" className="form-panel report-panel" method="post"
                action="/report-illegal-activity"
              >
                <FormMessage error={error} />
                <label className="form-label">
                  post URL<input className="form-control" type="url" name="contentUrl" required
                    defaultValue={values.contentUrl} placeholder={`${origin}/post/123`} autoComplete="url"
                    inputMode="url" enterkeyhint="next" />
                </label>
                <label className="form-label">
                  category<select className="form-control form-select" name="category" required
                    defaultValue={values.category || ''}
                  >
                    <option value="" disabled>choose</option>
                    <option value="hate">illegal hate speech</option>
                    <option value="privacy">privacy violation</option>
                    <option value="copyright">copyright</option>
                    <option value="fraud">fraud or unlawful activity</option>
                    <option value="child_safety">child safety offence</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <label className="form-label">
                  details<textarea className="form-control" name="details" required minLength={20} maxLength={3000}
                    defaultValue={values.details} placeholder="Explain what you believe is illegal and why."
                    autoComplete="off" inputMode="text" enterkeyhint="enter" />
                </label>
                <label className="form-label">
                  name<input className="form-control" name="name" maxLength={200} defaultValue={values.name}
                    autoComplete="name" inputMode="text" enterkeyhint="next" />
                </label>
                <label className="form-label">
                  email<input className="form-control" type="email" name="email" maxLength={254}
                    defaultValue={values.email} placeholder="you@example.com" autoComplete="email" inputMode="email"
                    enterkeyhint="done" />
                </label>
                <p className="form-hint identity-exception-hint">
                  Name and email may be omitted only for a child-safety offence report.
                </p>
                <label className="good-faith form-hint">
                  <input className="form-checkbox" type="checkbox" name="goodFaith" value="yes" required
                    defaultChecked={values.goodFaith === 'yes'} />
                  <span>I believe in good faith that this report is accurate and complete.</span>
                </label>
                <FormActions primary={<button className="button">submit report</button>} />
              </Panel>
            </>
          )}
      </article>
    </Layout>
  )
}
