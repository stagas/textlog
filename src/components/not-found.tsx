import type { User } from '../db'
import { Layout } from './layout'

export function NotFound({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="page not found">
      <section className="not-found" aria-labelledby="not-found-title">
        <p className="not-found-code" aria-hidden="true">404</p>
        <div className="not-found-copy">
          <p className="eyebrow">lost root</p>
          <h1 id="not-found-title">This page doesn't exist.</h1>
          <p>The link may be outdated, or the page may have moved.</p>
          <div className="not-found-actions">
            <a className="button" href="/">browse notes</a>
            <span>or</span>
            <a href="/explore">explore</a>
          </div>
        </div>
      </section>
    </Layout>
  )
}
