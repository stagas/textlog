import type { User } from '../types'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'
import { CenteredPanel, PanelCopy, PanelHeading } from './panel'

export function InviteFriends({ user, emails = '', error, sent = 0, returnPath }: {
  user: User
  emails?: string
  error?: string
  sent?: number
  returnPath?: string
}) {
  return (
    <Layout user={user} title="invite friends">
      <CenteredPanel className="invite-panel" width="medium">
        <p className="eyebrow">share textlog</p>
        <PanelHeading>Bring your friends along</PanelHeading>
        <PanelCopy>
          Your friends will get a magic link to join textlog.<br />
          Enter email addresses separated by spaces or commas.
        </PanelCopy>
        <FormMessage error={error} success={sent
          ? `${sent} ${sent === 1 ? 'invitation' : 'invitations'} sent.`
          : undefined} />
        <form className="panel-gallery-form invite-form" method="post" action="/account/edit/invite">
          {returnPath && <input type="hidden" name="from" value={returnPath} />}
          <label className="form-label">
            email addresses
            <textarea className="form-control" name="emails" required maxLength={25_500} defaultValue={emails}
              placeholder="friend@example.com, another@example.com" autoComplete="off" inputMode="email"
              enterKeyHint="enter" aria-describedby="invite-email-help" autoFocus />
            <span className="form-hint" id="invite-email-help">Separate addresses with a space or comma.</span>
          </label>
          <FormActions
            primary={<button className="button">send invitations →</button>}
            secondary={
              <a className="secondary-action cancel-action" href={returnPath
                ? `/account/edit?from=${encodeURIComponent(returnPath)}`
                : '/account/edit'}
              >
                cancel
              </a>
            }
          />
        </form>
      </CenteredPanel>
    </Layout>
  )
}
