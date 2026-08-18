import { instance } from '../../instance.config'
import { appName } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'

export function Dmca({ user }: { user: User | null }) {
  const name = appName()
  return (
    <Layout user={user} title="copyright">
      <article className="static-page legal-page">
        <p className="eyebrow">copyright</p>
        <h1>DMCA notices and counter-notices</h1>
        <p>
          Send copyright notices to {instance.operator.name} at {instance.operator.email
            ? <a href={`mailto:${instance.operator.email}`}>{instance.operator.email}</a>
            : 'the configured contact email'}
          {instance.operator.phone && (
            <>
              , <a href={instance.operator.phone.url}>{instance.operator.phone.display}</a>
            </>
          )}
          {instance.operator.address && <>, {instance.operator.address}</>}.
        </p>
        <h2>Copyright notice</h2>
        <p>
          Identify the copyrighted work, the exact {name}{' '}
          URL, the allegedly infringing material, your contact details, and include the statements and signature
          required by 17 U.S.C. §512(c)(3).
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
