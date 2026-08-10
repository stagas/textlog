import type { User } from '../db'
import { Layout } from './layout'

export function NotificationSettings({ user, publicKey }: { user: User; publicKey: string | null }) {
  return (
    <Layout user={user} title="notifications">
      <article className="static-page">
        <div className="notification-heading">
          <div><p className="eyebrow">account</p><h1>notifications</h1></div>
          <a className="quiet" href="/account/edit">back</a>
        </div>
        <p id="notification-status">
          {publicKey
            ? 'Enabling notifications uses JavaScript on this page and installs a small service worker in your browser.'
            : 'Notifications are unavailable.'}
        </p>
        <p id="notification-preference-hint" hidden>Choose which activity reaches this browser.</p>
        <form id="notification-preference-form">
          <fieldset className="notification-preferences" id="notification-preferences" disabled hidden>
            <legend>notify me about</legend>
            {[
              ['latest', 'new notes', 'Everything newly published in /latest'],
              ['ownPosts', 'include own messages', 'Also notify you about notes you publish'],
              ['replies', 'replies', 'When someone replies to one of your notes'],
              ['mentions', 'mentions', 'When someone mentions your handle'],
              ['follows', 'new followers', 'When someone starts following you'],
            ].map(([name, label, description]) => (
              <label className={`notification-toggle${name === 'latest' ? ' notification-toggle-parent' : ''}${
                name === 'ownPosts' ? ' notification-toggle-dependent' : ''}`}
                key={name}>
                <span><strong>{label}</strong><small>{description}</small></span>
                <input type="checkbox" name={name} defaultChecked />
                <span className="notification-toggle-track" aria-hidden="true"><span /></span>
              </label>
            ))}
          </fieldset>
        </form>
        <div className="notification-actions">
          <button className="button" id="enable-notifications" disabled={!publicKey} hidden>enable notifications</button>
          <button className="button" id="save-notification-preferences" form="notification-preference-form" hidden>
            save preferences
          </button>
          <a className="quiet" id="disable-notifications" href="/account/edit/notifications" hidden>
            disable notifications
          </a>
        </div>
        {publicKey && <script src="/notifications.js" data-vapid-public-key={publicKey} />}
      </article>
    </Layout>
  )
}
