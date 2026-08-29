import type { User } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'

export function AdminPush({ user, sent }: { user: User; sent?: 'test' | 'all' }) {
  return (
    <Layout user={user} title="send push notification">
      <PageHeading
        className="admin-header"
        eyebrow="admin operations"
        title="send push notification"
        action={<a className="profile-edit-link" href="/admin">dashboard</a>}
      />
      <section className="admin-email">
        <FormMessage success={sent === 'test'
          ? 'Test notification sent.'
          : sent === 'all' ? 'Notification sent to all subscribers.' : undefined} />
        <form method="post" action="/admin/push">
          <label className="form-label">
            title
            <input className="form-control" name="title" maxLength={200} required autoComplete="off" />
          </label>
          <label className="form-label">
            body
            <textarea className="form-control" name="body" maxLength={2_000} required autoComplete="off" />
          </label>
          <label className="form-label">
            destination URL
            <input className="form-control" name="url" maxLength={2_048} required autoComplete="off"
              inputMode="url" placeholder="/latest or https://textlog.cc/" />
          </label>
          <FormActions
            secondary={<button className="quiet" name="audience" value="test">Test</button>}
            primary={<button className="button" name="audience" value="all">Send to all →</button>}
          />
        </form>
      </section>
    </Layout>
  )
}
