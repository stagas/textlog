import type { User } from '../db'
import { Layout } from './layout'

export function Dmca({ user }: { user: User | null }) {
  return (
    <Layout user={user} title="copyright">
      <article className="static-page legal-page">
        <p className="eyebrow">copyright</p>
        <h1>DMCA notices and counter-notices</h1>
        <p>
          Send copyright notices to Georgios Stagakis at <a href="mailto:hello@textlog.cc">hello@textlog.cc</a>,{' '}
          <a href="tel:+306946600152">+30 694 660 0152</a>, Kallikratis, Crete, Greece 730 11.
        </p>
        <h2>Copyright notice</h2>
        <p>
          Identify the copyrighted work, the exact textlog URL, the allegedly infringing material, your contact details,
          and include the statements and signature required by 17 U.S.C. §512(c)(3).
        </p>
        <h2>Counter-notice</h2>
        <p>
          If your content was removed by mistake or misidentification, send the removed URL, your contact details, the
          statements required by 17 U.S.C. §512(g)(3), consent to the appropriate U.S. federal court’s jurisdiction, and
          your physical or electronic signature.
        </p>
        <h2>Process</h2>
        <p>
          Valid notices are reviewed promptly. We may remove or restore content and forward notices or counter-notices
          to the affected party as permitted by law. Repeat infringers may lose their accounts.
        </p>
      </article>
    </Layout>
  )
}
