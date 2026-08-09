import { type User } from '../db'
import type { SessionView } from '../types'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function AccountSecurity({ user, sessions, error, success }: {
  user: User
  sessions: SessionView[]
  error?: string
  success?: string
}) {
  return (
    <Layout user={user} title="account security">
      <section className="page-header security-header">
        <div className="profile-title-row">
          <h1>security</h1>
          <a className="profile-edit-link" href="/account/edit">back</a>
        </div>
      </section>
      <div className="security-page">
        <FormMessage error={error} success={success} />
        <section className="security-section">
          <h2>email</h2>
          <p>{user.email}</p>
          <form className="security-form" method="post" action="/account/email/change">
            <label>
              new email
              <input type="email" name="email" required maxLength={254} autoComplete="email" />
            </label>
            <button className="button">confirm new email →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>magic link</h2>
          <p>Generate a one-time sign-in link to copy to another device. It expires after one hour.</p>
          <form className="security-form" method="post" action="/account/magic-link">
            <button className="button">generate magic link →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>api access</h2>
          <p>
            Off by default. Turn it on to post, reply and follow from an app using the API. Sessions an app
            creates appear below and can be revoked here.
          </p>
          <form className="security-form" method="post" action="/account/api-writes">
            <button className="button">
              {user.api_writes_enabled_at ? 'turn off api access →' : 'turn on api access →'}
            </button>
          </form>
        </section>
        <section className="security-section">
          <h2>sessions</h2>
          <div className="session-list">
            {sessions.map(session => (
              <article key={session.token}>
                <div>
                  <strong>{session.current ? 'this session' : 'signed-in session'}</strong>
                  <span>
                    {session.user_agent || 'Unknown browser'} · expires{' '}
                    <time dateTime={new Date(session.expires_at).toISOString()}>
                      {new Date(session.expires_at).toLocaleDateString('en')}
                    </time>
                  </span>
                </div>
                {!session.current && (
                  <form method="post" action="/account/sessions/revoke">
                    <input type="hidden" name="token" value={session.token} />
                    <button className="quiet danger">revoke</button>
                  </form>
                )}
              </article>
            ))}
          </div>
          {sessions.length > 1 && (
            <form method="post" action="/account/sessions/revoke-others">
              <button className="quiet danger">revoke all other sessions</button>
            </form>
          )}
        </section>
      </div>
    </Layout>
  )
}

export function AccountMagicLink({ user, magicUrl }: { user: User; magicUrl: string }) {
  return (
    <Layout user={user} title="magic link">
      <div className="panel magic-link-page">
        <h1>magic link</h1>
        <p>Copy this one-time sign-in link to your other device. It expires after one hour.</p>
        <label className="magic-link-output">
          magic link
          <textarea readOnly value={magicUrl} autoFocus spellCheck={false} aria-label="magic link URL" />
        </label>
        <a className="quiet" href="/account/security">back to account security</a>
      </div>
    </Layout>
  )
}
