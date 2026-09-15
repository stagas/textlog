import type { User } from '../types'
import { AccountSettingsHeader } from './account-settings-header'
import { Layout } from './layout'

export function AccountManagement({ user, returnPath }: { user: User; returnPath?: string }) {
  return (
    <Layout user={user} title="account settings">
      <article className="static-page notifications-page account-management-page">
        <AccountSettingsHeader title="account" returnPath={returnPath} anchor="account" />
        <div className="account-share-panels account-management-panels">
          <div className="account-danger-zone account-share-panel" id="download-data">
            <div>
              <strong>Download your data</strong>
              <span>Export your account, notes, connections, and activity as a JSON file.</span>
            </div>
            <a className="button" href="/account/export" download>download data</a>
          </div>
          <div className="account-danger-zone account-share-panel" id="delete-account">
            <span className="danger-zone-label">DANGER ZONE</span>
            <div>
              <strong>Delete account</strong>
              <span>Permanently remove your profile and turn your notes into deleted tombstones.</span>
            </div>
            <a className="button button-danger" href="/account/delete">delete account</a>
          </div>
        </div>
      </article>
    </Layout>
  )
}
