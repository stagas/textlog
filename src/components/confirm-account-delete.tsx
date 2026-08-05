import { type User } from '../db'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function ConfirmAccountDelete({ user, error }: { user: User; error?: string }) {
  return (
    <Layout user={user} title="delete account">
      <div className="panel confirm-delete">
        <h1>Delete your account?</h1>
        <p>
          This cannot be undone. Your profile and account data will be removed, and all your notes will become
          “(deleted)” tombstones so existing conversations remain readable.
        </p>
        <form className="account-delete-form" method="post" action="/account/delete">
          <FormMessage error={error} />
          <div className="form-actions">
            <a className="quiet" href="/account/edit">cancel</a>
            <button className="button delete-button" type="submit">delete account</button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
