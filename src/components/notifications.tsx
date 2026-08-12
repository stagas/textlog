import { isAdmin } from '../admin'
import { appName } from '../brand'
import type { User } from '../db'
import { Layout } from './layout'

export function NotificationSettings({ user, publicKey, ios = false }: {
  user: User
  publicKey: string | null
  ios?: boolean
}) {
  const name = appName()
  return (
    <Layout user={user} title="notifications">
      <article className="static-page notifications-page">
        <div className="notification-heading">
          <div>
            <p className="eyebrow">account</p>
            <h1>notifications</h1>
          </div>
          <a className="quiet" href="/account/edit">back</a>
        </div>
        <p id="notification-status">
          {publicKey
            ? 'Enabling notifications uses JavaScript on this page and installs a small service worker in your browser.'
            : 'Notifications are unavailable.'}
        </p>
        <p id="notification-preference-hint" hidden>Choose which activity reaches this browser.</p>
        {ios && (
          <aside className="ios-notification-help">
            <strong>Install {name} first</strong>
            <p>On iPhone and iPad, notifications work only when {name} is opened as a Home Screen web app.</p>
            <ol>
              <li>Open {name} in Safari and tap Share.</li>
              <li>Choose Add to Home Screen and turn on Open as Web App.</li>
              <li>Tap Add, then open {name} from its new Home Screen icon.</li>
              <li>Return to this page and enable notifications.</li>
            </ol>
            <a className="quiet" href="https://support.apple.com/guide/iphone/iphea86e5236/ios" target="_blank"
              rel="noopener noreferrer"
            >
              Apple’s instructions
            </a>
          </aside>
        )}
        <form id="notification-preference-form">
          <fieldset className="notification-preferences" id="notification-preferences" disabled hidden>
            <legend>notify me about</legend>
            <fieldset className="notification-radio-group">
              <legend className="visually-hidden">new notes</legend>
              <div className="notification-radio-heading">
                <strong>new notes</strong>
                <label className="notification-radio-enable">
                  <span className="visually-hidden">enable new note notifications</span>
                  <input type="checkbox" name="notesEnabled" defaultChecked />
                  <span className="notification-toggle-track" aria-hidden="true">
                    <span />
                  </span>
                </label>
              </div>
              <div className="notification-radio-options">
                <label>
                  <input type="radio" name="noteScope" value="latest" defaultChecked />
                  <span>
                    <strong>latest</strong>
                    <small>Everything in /latest</small>
                  </span>
                </label>
                <label>
                  <input type="radio" name="noteScope" value="following" />
                  <span>
                    <strong>following</strong>
                    <small>People and tags you follow</small>
                  </span>
                </label>
              </div>
            </fieldset>
            {[
              ['ownPosts', 'include own messages', 'Also notify for own notes'],
              ['replies', 'replies', 'When someone replies to one of your notes'],
              ['mentions', 'mentions', 'When someone mentions your handle'],
              ['follows', 'new followers', 'When someone starts following you'],
              ['followActivity', 'follow activity', 'When people or tags you follow gain a new follow'],
              ...(isAdmin(user)
                ? [['signups', 'new user signups', 'When a new user creates an account']]
                : []),
            ].map(([name, label, description]) => (
              <label
                className={`notification-toggle${name === 'ownPosts' ? ' notification-toggle-dependent' : ''}`}
                key={name}
              >
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <input type="checkbox" name={name} defaultChecked />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
            ))}
          </fieldset>
        </form>
        <div className="notification-actions">
          <button className="button" id="enable-notifications" disabled={!publicKey} hidden>
            enable notifications
          </button>
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
