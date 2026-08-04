import type { User } from '../db'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function IllegalActivityReport(
  { user, error, reference, values = {} }: { user: User | null; error?: string; reference?: string;
    values?: Record<string, string> },
) {
  return (
    <Layout user={user} title="report illegal activity">
      <article className="static-page illegal-activity-page">
        <p className="eyebrow">safety</p>
        <h1>Report illegal activity</h1>
        {reference
          ? (
            <p role="status">
              Your report was received. Reference: <strong>{reference}</strong>.
            </p>
          )
          : (
            <>
              <p>Use this form to report a specific root.mx post that you believe involves illegal activity.</p>
              <form className="panel report-panel" method="post" action="/report-illegal-activity">
                <FormMessage error={error} />
                <label>
                  post URL<input type="url" name="contentUrl" required defaultValue={values.contentUrl}
                    placeholder="https://root.mx/post/123" />
                </label>
                <label>
                  category<select name="category" required defaultValue={values.category || ''}>
                    <option value="" disabled>choose</option>
                    <option value="hate">illegal hate speech</option>
                    <option value="privacy">privacy violation</option>
                    <option value="copyright">copyright</option>
                    <option value="fraud">fraud or unlawful activity</option>
                    <option value="child_safety">child safety offence</option>
                    <option value="other">other</option>
                  </select>
                </label>
                <label>
                  details<textarea name="details" required minLength={20} maxLength={3000} defaultValue={values.details}
                    placeholder="Explain what you believe is illegal and why." />
                </label>
                <label>
                  name<input name="name" maxLength={200} defaultValue={values.name} />
                </label>
                <label>
                  email<input type="email" name="email" maxLength={254} defaultValue={values.email}
                    placeholder="you@example.com" />
                </label>
                <p className="quiet">Name and email may be omitted only for a child-safety offence report.</p>
                <label className="good-faith">
                  <input type="checkbox" name="goodFaith" value="yes" required />{' '}
                  I believe in good faith that this report is accurate and complete.
                </label>
                <button className="button">submit report</button>
              </form>
            </>
          )}
      </article>
    </Layout>
  )
}
