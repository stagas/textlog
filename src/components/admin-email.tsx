import type { User } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'

export function AdminEmail({ user, sent = false }: { user: User; sent?: boolean }) {
  return (
    <Layout user={user} title="send email">
      <PageHeading
        className="admin-header"
        eyebrow="admin operations"
        title="send email"
        action={<a className="profile-edit-link" href="/admin">dashboard</a>}
      />
      <section className="admin-email">
        <FormMessage success={sent ? 'Email sent.' : undefined} />
        <form method="post" action="/admin/email">
          <label className="form-label">
            sender email
            <input className="form-control" name="from" defaultValue="textlog &lt;hello@textlog.cc&gt;" maxLength={320}
              required autoComplete="off" inputMode="email" enterkeyhint="next" />
          </label>
          <label className="form-label">
            recipient email
            <input className="form-control" name="email" type="email" maxLength={254} required autoComplete="off"
              inputMode="email" enterkeyhint="next" />
          </label>
          <label className="form-label">
            title
            <input className="form-control" name="title" maxLength={200} required autoComplete="off" inputMode="text"
              enterkeyhint="next" />
          </label>
          <label className="form-label">
            body
            <textarea className="form-control" name="body" maxLength={20_000} required autoComplete="off"
              inputMode="text" enterkeyhint="enter" />
          </label>
          <FormActions primary={<button className="button">send email →</button>} />
        </form>
      </section>
    </Layout>
  )
}
