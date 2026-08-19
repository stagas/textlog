import type { User } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { CenteredPanel } from './panel'

export function PersonalizedFeedLanding(
  { landingUrl, rssUrl, atomUrl, user, created }: { landingUrl: string; rssUrl: string; atomUrl: string;
    user?: User | null; created?: boolean },
) {
  return (
    <Layout user={user} title="For You feed" feeds={{ title: 'For You', rss: rssUrl, atom: atomUrl }}>
      <CenteredPanel className="magic-link-page" width="medium">
        <h1>For You feed</h1>
        <p>
          {created
            ? 'Your private feed key was created. Copy and save this secret feed address now.'
            : 'This private, read-only feed is available in both formats:'}
        </p>
        <p>
          <a href={rssUrl}>RSS feed</a>
          {' · '}
          <a href={atomUrl}>Atom feed</a>
        </p>
        {created && (
          <label className="magic-link-output">
            <span className="feed-self-link">
              <a href={landingUrl}>Feed</a>
            </span>
            <output className="form-control magic-link-value api-key-output feed-url-output" tabIndex={0}
              aria-label="Feed landing page URL"
            >
              {landingUrl}
            </output>
          </label>
        )}
        <p>Anyone with these links can read your personalized feed. Treat them like secrets.</p>
        {created && <FormActions primary={<a className="button" href="/account/security">I’ve saved it</a>} />}
      </CenteredPanel>
    </Layout>
  )
}
