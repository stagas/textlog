import { type User } from '../db'
import { Layout } from './layout'

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
        {sent && <p className="admin-email-success" role="status">Email sent.</p>}
        <form method="post" action="/admin/email">
          <label>
            recipient email
            <input name="email" type="email" maxLength={254} required autoComplete="off" />
          </label>
          <label>
            title
            <input name="title" maxLength={200} required />
          </label>
          <label>
            body
            <textarea name="body" maxLength={20_000} required />
          </label>
          <div className="form-actions">
            <button className="button">send email →</button>
          </div>
        </form>
      </section>
    </Layout>
  )
}
