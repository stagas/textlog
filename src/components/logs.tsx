import type { User } from '../types'
import { Layout } from './layout'

export function LogsPage({ user }: { user: User }) {
  return (
    <Layout title="logs" user={user}>
      <section className="logs-page">
        <pre id="logs-output" aria-live="off" aria-label="Server logs" />
      </section>
      <script src="/logs.js?v=9" defer />
    </Layout>
  )
}
