import type { User } from '../types'
import type { ApiKeyView, FeedKeyView, SessionView } from '../types'
import { AccountSettingsHeader } from './account-settings-header'
import { maskEmail } from './email-address'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { CenteredPanel, PanelCopy, PanelHeading } from './panel'

function SecuritySection({ title, description, id, children }: {
  title: string
  description?: React.ReactNode
  id?: string
  children: React.ReactNode
}) {
  return (
    <section className="security-section" id={id}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </section>
  )
}

export function AccountSecurity(
  { user, sessions, apiKeys = [], feedKeys = [], passwordEnabled, error, success, returnPath }: {
    user: User
    sessions: SessionView[]
    apiKeys?: ApiKeyView[]
    feedKeys?: FeedKeyView[]
    passwordEnabled?: boolean
    error?: string
    success?: string
    returnPath?: string
  },
) {
  const fromQuery = returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''
  return (
    <Layout user={user} title="account security">
      <section className="security-header">
        <AccountSettingsHeader title="security" returnPath={returnPath} anchor="security" />
      </section>
      <div className="security-page">
        <FormMessage error={error} success={success} />
        <SecuritySection title="email" description={maskEmail(user.email)}>
          <form className="security-form" method="post" action="/account/email/change">
            <label>
              new email
              <input type="email" name="email" required maxLength={254} autoComplete="email" inputMode="email"
                enterkeyhint={passwordEnabled ? 'next' : 'done'} />
            </label>
            {passwordEnabled && (
              <label>
                current password
                <input type="password" name="password" required maxLength={128} autoComplete="current-password"
                  enterkeyhint="done" />
              </label>
            )}
            <button className="button">confirm new email →</button>
          </form>
        </SecuritySection>
        <SecuritySection title="magic link"
          description="Generate a one-time sign-in link to copy to another device. It expires after 15 minutes."
        >
          <form className="security-form" method="post" action="/account/magic-link">
            <button className="button">generate magic link →</button>
          </form>
        </SecuritySection>
        <SecuritySection title="password login" description={passwordEnabled
          ? 'Change the password you use to log in.'
          : 'Add a password as an alternative to email magic links.'}
        >
          <a className="button" href={(passwordEnabled ? '/account/password/change' : '/account/password/enable')
            + fromQuery}
          >
            {passwordEnabled ? 'change password →' : 'enable password login →'}
          </a>
        </SecuritySection>
        <SecuritySection id="api-keys" title="API keys"
          description="Create a bearer token for scripts and apps. Keys are shown once and can be revoked at any time."
        >
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
        </SecuritySection>
        <SecuritySection id="feed-keys" title="Feed key"
          description="Create a private, read-only RSS or Atom feed for My Feed. Treat its URL like a password."
        >
          <a className="button" href="/account/feed-keys/new">generate feed key →</a>
          {feedKeys.length > 0 && (
            <div className="session-list api-key-list">
              {feedKeys.map(key => (
                <article key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <span>
                      {key.last_used_at
                        ? `last used ${new Date(key.last_used_at).toLocaleDateString('en')}`
                        : 'never used'}
                      {' · '}
                      {key.expires_at
                        ? `expires ${new Date(key.expires_at).toLocaleDateString('en')}`
                        : 'never expires'}
                    </span>
                  </div>
                  <form method="post" action="/account/feed-keys/revoke">
                    <input type="hidden" name="id" value={key.id} />
                    <button className="quiet danger">revoke</button>
                  </form>
                </article>
              ))}
            </div>
          )}
        </SecuritySection>
        <SecuritySection id="sessions" title="sessions">
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
        </SecuritySection>
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
              autoFocus autoComplete="off" inputMode="text" enterkeyhint="done" />
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
            secondary={<a className="secondary-action cancel-action" href="/account/security">cancel</a>}
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
      <CenteredPanel className="magic-link-page api-key-created-page" width="medium">
        <h1>API key created</h1>
        <p>
          Copy <strong>{name}</strong> now. For your security, this key will not be shown again.
        </p>
        <label className="magic-link-output">
          bearer token
          <output className="form-control magic-link-value api-key-output" tabIndex={0} aria-label="API key">
            {value}
          </output>
        </label>
        <p>
          Store it like a password and send it as:<br />
          <code>Authorization: Bearer &lt;key&gt;</code>
        </p>
        <FormActions primary={<a className="button" href="/account/security">I saved it</a>} />
      </CenteredPanel>
    </Layout>
  )
}

export function AccountFeedKeyCreate({ user, name = '', lifetime = 'year', error }: {
  user: User
  name?: string
  lifetime?: string
  error?: string
}) {
  return (
    <Layout user={user} title="generate feed key">
      <section className="security-header">
        <AccountSettingsHeader title="generate feed key" />
      </section>
      <div className="security-page api-key-create-page">
        <p className="api-key-create-intro">Create a read-only key for My Feed.</p>
        <FormMessage error={error} />
        <form className="security-form api-key-form" method="post" action="/account/feed-keys">
          <label>
            key name<input name="name" required minLength={1} maxLength={64} placeholder="my feed reader"
              defaultValue={name} autoFocus autoComplete="off" />
          </label>
          <fieldset className="api-key-lifetimes">
            <legend>expiration</legend>
            {[
              ['90-days', '90 days', 'For temporary feed readers'],
              ['year', '1 year', 'A safer default for ongoing subscriptions'],
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
          <FormActions secondary={<a className="secondary-action cancel-action" href="/account/security">cancel</a>}
            primary={<button className="button">generate feed key →</button>} />
        </form>
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
      <CenteredPanel shellClassName={request ? 'enable-password-shell' : 'auth-shell'} className={request
        ? 'enable-password-panel'
        : `auth-panel password-panel${enabled ? '' : ' enable-password-panel'}`} width={enabled ? 'narrow' : 'medium'}
      >
        {request
          ? <PanelHeading as="h1">Enable password login</PanelHeading>
          : (
            <h1>
              {invalid
                ? 'Link unavailable'
                : sent
                ? 'Check your email'
                : enabled
                ? 'Change password'
                : 'Set a password'}
            </h1>
          )}
        {error && <p className="status-message status-error" role="alert">{error}</p>}
        {invalid
          ? <p className="switch">This link is invalid, expired, or already used.</p>
          : sent
          ? (
            <>
              <p className="switch">
                We sent a secure setup link to{' '}
                <strong>{user?.email && maskEmail(user.email)}</strong>. It expires in one hour.
              </p>
              <p className="email-delivery-hint">Can’t find it? Check your spam or junk folder.</p>
            </>
          )
          : request
          ? (
            <>
              <PanelCopy>We’ll email you a secure link before you can set a password.</PanelCopy>
              <form method="post" action="/account/password/enable">
                <FormActions secondary={<a className="secondary-action" href="/account/security">back</a>}
                  primary={<button className="button">send setup link →</button>} />
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
                    autoComplete="current-password" enterkeyhint="next" autoFocus />
                </>
              )}
              <label htmlFor="new-password">
                <span>{enabled ? 'new password' : 'password'}</span>
              </label>
              <input id="new-password" type="password" name="newPassword" required minLength={8} maxLength={128}
                autoComplete="new-password" enterkeyhint="done" autoFocus={!enabled} placeholder="8–128 characters" />
              <button className="button">
                {enabled ? 'change password' : 'enable password login'} <span>→</span>
              </button>
            </form>
          )}
        {!request && (
          <p className="auth-secondary">
            <a href="/account/security">Back to account security</a>
          </p>
        )}
      </CenteredPanel>
    </Layout>
  )
}

export function AccountMagicLink({ user, magicUrl, code }: { user: User; magicUrl: string; code: string }) {
  return (
    <Layout user={user} title="magic link">
      <CenteredPanel className="magic-link-page" width="medium">
        <h1>magic link</h1>
        <p>
          Copy this one-time sign-in link to your other device.<br />It expires after 15 minutes.
        </p>
        <label className="magic-link-output">
          magic link
          <output className="form-control magic-link-value" tabIndex={0} aria-label="magic link URL">{magicUrl}</output>
        </label>
        <label className="magic-link-output app-entry-code">
          app entry code
          <output className="form-control magic-link-value" tabIndex={0} aria-label="app entry code">{code}</output>
        </label>
        <FormActions primary={<a className="button" href="/account/security">I copied it</a>} />
      </CenteredPanel>
    </Layout>
  )
}
