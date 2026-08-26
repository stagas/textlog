import { isAdmin } from '../admin'
import { appName } from '../brand'
import type { User } from '../types'
import { AccountSettingsHeader } from './account-settings-header'
import { Layout } from './layout'

export function NotificationSettings({ user, publicKey, ios = false, returnPath }: {
  user: User
  publicKey: string | null
  ios?: boolean
  returnPath?: string
}) {
  const name = appName()
  return (
    <Layout user={user} title="notifications">
      <article className="static-page notifications-page">
        <AccountSettingsHeader title="notifications" returnPath={returnPath} />
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
            <legend>notify @{user.handle} about</legend>
            <fieldset className="notification-radio-group">
              <legend className="visually-hidden">feed notifications</legend>
              <label className="notification-toggle">
                <span>
                  <strong>latest</strong>
                  <small>Everything in /latest</small>
                </span>
                <input type="checkbox" name="latest" defaultChecked />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
              <label className="notification-toggle notification-toggle-parent">
                <span>
                  <strong>for you</strong>
                  <small>Followed activity, replies, mentions, and new followers</small>
                </span>
                <input type="checkbox" name="forYou" defaultChecked />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
              <label className="notification-toggle notification-toggle-dependent">
                <span>
                  <strong>include people&apos;s follow activity</strong>
                  <small>When someone you follow follows a person</small>
                </span>
                <input type="checkbox" name="peopleFollowActivity" />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
              <label className="notification-toggle notification-toggle-dependent">
                <span>
                  <strong>include hashtag follow activity</strong>
                  <small>When someone follows a hashtag relevant to you</small>
                </span>
                <input type="checkbox" name="hashtagFollowActivity" />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
              <label className="notification-toggle notification-toggle-dependent notification-toggle-group-end">
                <span>
                  <strong>only to me</strong>
                  <small>Only notes addressed to me</small>
                </span>
                <input type="checkbox" name="onlyToMe" defaultChecked />
                <span className="notification-toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
            </fieldset>
            {[
              ...(isAdmin(user)
                ? [['signups', 'new user signups', 'When a new user creates an account']]
                : []),
            ].map(([name, label, description]) => (
              <label className="notification-toggle" key={name}>
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
        {publicKey && <script src="/notifications.js" data-vapid-public-key={publicKey} data-handle={user.handle} />}
      </article>
    </Layout>
  )
}
