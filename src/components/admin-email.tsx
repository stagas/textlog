import { type User } from '../db'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'

export function AdminEmail({ user, sent = false }: { user: User; sent?: boolean }) {
  return (
    <Layout user={user} title="send email">
      <section className="page-header admin-header">
        <div>
          <p className="eyebrow">admin operations</p>
          <h1>send email</h1>
        </div>
        <a className="quiet" href="/admin">dashboard</a>
      </section>
      <section className="admin-email">
        <FormMessage success={sent ? 'Email sent.' : undefined} />
        <form method="post" action="/admin/email">
          <label className="form-label">
            recipient email
            <input className="form-control" name="email" type="email" maxLength={254} required autoComplete="off" />
          </label>
          <label className="form-label">
            title
            <input className="form-control" name="title" maxLength={200} required />
          </label>
          <label className="form-label">
            body
            <textarea className="form-control" name="body" maxLength={20_000} required />
          </label>
          <FormActions primary={<button className="button">send email →</button>} />
        </form>
      </section>
    </Layout>
  )
}
