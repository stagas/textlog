import { type User } from '../db'
import type { ApiKeyView, SessionView } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { AccountSettingsHeader } from './account-settings-header'

export function AccountSecurity({ user, sessions, apiKeys = [], passwordEnabled, error, success, returnPath }: {
  user: User
  sessions: SessionView[]
  apiKeys?: ApiKeyView[]
  passwordEnabled?: boolean
  error?: string
  success?: string
  returnPath?: string
}) {
  const fromQuery = returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''
  return (
    <Layout user={user} title="account security">
      <section className="security-header">
        <AccountSettingsHeader title="security" returnPath={returnPath} />
      </section>
      <div className="security-page">
        <FormMessage error={error} success={success} />
        <section className="security-section">
          <h2>email</h2>
          <p>{user.email}</p>
          <form className="security-form" method="post" action="/account/email/change">
            <label>
              new email
              <input type="email" name="email" required maxLength={254} autoComplete="email" inputMode="email"
                enterKeyHint={passwordEnabled ? 'next' : 'done'} />
            </label>
            {passwordEnabled && (
              <label>
                current password
                <input type="password" name="password" required maxLength={128} autoComplete="current-password"
                  enterKeyHint="done" />
              </label>
            )}
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
          <p>
            {passwordEnabled
              ? 'Change the password you use to log in.'
              : 'Add a password as an alternative to email magic links.'}
          </p>
          <a className="button" href={(passwordEnabled ? '/account/password/change' : '/account/password/enable')
            + fromQuery}
          >
            {passwordEnabled ? 'change password →' : 'enable password login →'}
          </a>
        </section>
        <section className="security-section">
          <h2>API keys</h2>
          <p>Create a bearer token for scripts and apps. Keys are shown once and can be revoked at any time.</p>
          <a className="button" href={`/account/api-keys/new${fromQuery}`}>generate API key →</a>
          {apiKeys.length > 0 && (
            <div className="session-list api-key-list">
              {apiKeys.map(key => (
                <article key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <span>
                      {key.last_used_at
                        ? `last used ${new Date(key.last_used_at).toLocaleDateString('en')}`
                        : 'never used'}
                      {' · '}
                      {key.expires_at
                        ? (
                          <>
                            expires{' '}
                            <time dateTime={new Date(key.expires_at).toISOString()}>
                              {new Date(key.expires_at).toLocaleDateString('en')}
                            </time>
                          </>
                        )
                        : 'never expires'}
                    </span>
                  </div>
                  <form method="post" action="/account/api-keys/revoke">
                    <input type="hidden" name="id" value={key.id} />
                    <button className="quiet danger">revoke</button>
                  </form>
                </article>
              ))}
            </div>
          )}
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

export function AccountApiKeyCreate({ user, name = '', lifetime = 'year', error }: {
  user: User
  name?: string
  lifetime?: string
  error?: string
}) {
  return (
    <Layout user={user} title="generate API key">
      <section className="security-header">
        <AccountSettingsHeader title="generate API key" />
      </section>
      <div className="security-page api-key-create-page">
        <p className="api-key-create-intro">
          Create a bearer token for a script or app. You’ll only see the key once.
        </p>
        <FormMessage error={error} />
        <form className="security-form api-key-form" method="post" action="/account/api-keys">
          <label>
            key name
            <input name="name" required minLength={1} maxLength={64} placeholder="my integration" defaultValue={name}
              autoFocus autoComplete="off" inputMode="text" enterKeyHint="done" />
          </label>
          <fieldset className="api-key-lifetimes">
            <legend>expiration</legend>
            {[
              ['90-days', '90 days', 'For temporary scripts and short projects'],
              ['year', '1 year', 'A safer default for ongoing integrations'],
              ['never', 'never', 'Remains valid until you revoke it'],
            ].map(([value, label, description]) => (
              <label className="api-key-lifetime" key={value}>
                <input type="radio" name="lifetime" value={value} defaultChecked={value === lifetime} />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <FormActions
            secondary={<a className="secondary-action" href="/account/security">cancel</a>}
            primary={<button className="button">generate API key →</button>}
          />
        </form>
      </div>
    </Layout>
  )
}

export function AccountApiKey({ user, name, value }: { user: User; name: string; value: string }) {
  return (
    <Layout user={user} title="API key created">
      <section className="security-header">
        <AccountSettingsHeader title="API key created" />
      </section>
      <div className="security-page api-key-created-page">
        <p className="api-key-create-intro">
          Copy <strong>{name}</strong> now. For your security, this key will not be shown again.
        </p>
        <label className="magic-link-output">
          bearer token
          <input className="api-key-output" readOnly value={value} autoFocus spellCheck={false} aria-label="API key" />
        </label>
        <p>
          Store it like a password and send it as <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
        <FormActions primary={<a className="button" href="/account/security">I saved it</a>} />
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
          <h1>
            {invalid ? 'Link unavailable' : sent ? 'Check your email' : request ? 'Enable password login' : enabled
              ? 'Change password'
              : 'Set a password'}
          </h1>
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          {invalid
            ? <p className="switch">This link is invalid, expired, or already used.</p>
            : sent
            ? (
              <>
                <p className="switch">
                  We sent a secure setup link to <strong>{user?.email}</strong>. It expires in one hour.
                </p>
                <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
              </>
            )
            : request
            ? (
              <>
                <p className="switch">We’ll email you a secure link before you can set a password.</p>
                <form method="post" action="/account/password/enable">
                  <button className="button">
                    send setup link <span>→</span>
                  </button>
                </form>
              </>
            )
            : (
              <form method="post" action={enabled ? '/account/password/change' : '/account/password/enable'}>
                {!enabled && <input type="hidden" name="token" value={token} />}
                {enabled && (
                  <>
                    <label htmlFor="old-password">
                      <span>old password</span>
                    </label>
                    <input id="old-password" type="password" name="oldPassword" required maxLength={128}
                      autoComplete="current-password" enterKeyHint="next" autoFocus />
                  </>
                )}
                <label htmlFor="new-password">
                  <span>{enabled ? 'new password' : 'password'}</span>
                </label>
                <input id="new-password" type="password" name="newPassword" required minLength={8} maxLength={128}
                  autoComplete="new-password" enterKeyHint="done" autoFocus={!enabled}
                  placeholder="8–128 characters" />
                <button className="button">
                  {enabled ? 'change password' : 'enable password login'} <span>→</span>
                </button>
              </form>
            )}
          <p className="auth-secondary">
            <a href="/account/security">Back to account security</a>
          </p>
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
