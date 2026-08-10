import { type User } from '../db'
import type { SessionView } from '../types'
import { Layout } from './layout'
import { FormMessage } from './page-shared'

export function AccountSecurity({ user, sessions, passwordEnabled, error, success }: {
  user: User
  sessions: SessionView[]
  passwordEnabled?: boolean
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
            {passwordEnabled && <label>
              current password
              <input type="password" name="password" required maxLength={128} autoComplete="current-password" />
            </label>}
            <button className="button">confirm new email →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>magic link</h2>
          <p>Generate a one-time sign-in link to copy to another device. It expires after 15 minutes.</p>
          <form className="security-form" method="post" action="/account/magic-link">
            <button className="button">generate magic link →</button>
          </form>
        </section>
        <section className="security-section">
          <h2>password login</h2>
          <p>{passwordEnabled
            ? 'Change the password you use to log in.'
            : 'Add a password as an alternative to email magic links.'}</p>
          <a className="button" href={passwordEnabled ? '/account/password/change' : '/account/password/enable'}>
            {passwordEnabled ? 'change password →' : 'enable password login →'}
          </a>
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

export function AccountPassword({ user, enabled, token, request = false, sent = false, invalid = false, error }: {
  user?: User | null
  enabled: boolean
  token?: string
  request?: boolean
  sent?: boolean
  invalid?: boolean
  error?: string
}) {
  return (
    <Layout user={user} title={enabled ? 'change password' : 'enable password login'}>
      <section className="auth-shell">
        <div className={`panel auth-panel password-panel${enabled ? '' : ' enable-password-panel'}`}>
          <h1>{invalid ? 'Link unavailable' : sent ? 'Check your email' : request ? 'Enable password login' : enabled
            ? 'Change password' : 'Set a password'}</h1>
          {error && <p className="error" role="alert">{error}</p>}
          {invalid
            ? <p className="switch">This link is invalid, expired, or already used.</p>
            : sent
            ? <>
              <p className="switch">We sent a secure setup link to <strong>{user?.email}</strong>. It expires in one hour.</p>
              <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            </>
            : request
            ? <>
              <p className="switch">We’ll email you a secure link before you can set a password.</p>
              <form method="post" action="/account/password/enable">
                <button className="button">send setup link <span>→</span></button>
              </form>
            </>
            : <form method="post" action={enabled ? '/account/password/change' : '/account/password/enable'}>
            {!enabled && <input type="hidden" name="token" value={token} />}
            {enabled && <>
              <label htmlFor="old-password"><span>old password</span></label>
              <input id="old-password" type="password" name="oldPassword" required maxLength={128}
                autoComplete="current-password" autoFocus />
            </>}
            <label htmlFor="new-password"><span>{enabled ? 'new password' : 'password'}</span></label>
            <input id="new-password" type="password" name="newPassword" required minLength={8} maxLength={128}
              autoComplete="new-password" autoFocus={!enabled} placeholder="8–128 characters" />
            <button className="button">{enabled ? 'change password' : 'enable password login'} <span>→</span></button>
          </form>}
          <p className="auth-secondary"><a href="/account/security">Back to account security</a></p>
        </div>
      </section>
    </Layout>
  )
}

export function AccountMagicLink({ user, magicUrl, code }: { user: User; magicUrl: string; code: string }) {
  return (
    <Layout user={user} title="magic link">
      <div className="panel magic-link-page">
        <h1>magic link</h1>
        <p>Copy this one-time sign-in link to your other device. It expires after 15 minutes.</p>
        <label className="magic-link-output">
          magic link
          <textarea readOnly value={magicUrl} autoFocus spellCheck={false} aria-label="magic link URL" />
        </label>
        <label className="magic-link-output app-entry-code">
          app entry code
          <input readOnly value={code} inputMode="numeric" aria-label="app entry code" />
        </label>
        <a className="quiet" href="/account/security">back to account security</a>
      </div>
    </Layout>
  )
}
