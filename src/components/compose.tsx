import { type User } from '../db'
import { Layout } from './layout'
import { FormMessage, VerificationRequired } from './page-shared'

export function Compose({ user, error, body = '' }: { user: User; error?: string; body?: string }) {
  if (!user.email_verified_at) {
    return <Layout user={user} title="write"><VerificationRequired /></Layout>
  }
  return (
    <Layout user={user} title="write">
      <div className="panel compose write-compose">
        <form method="post" action="/post">
          <FormMessage error={error} />
          <textarea name="body" maxLength={280} required autoFocus defaultValue={body}
            placeholder="What's on your mind?" />
          <div className="composefoot">
            <span>280 characters max · use #hashtags and @mentions</span>
            <button className="button">post →</button>
          </div>
        </form>
      </div>
    </Layout>
  )
}
