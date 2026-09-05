import type { AppearanceExperimentRanking } from '../appearance-experiment'
import type { User } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'

export function AdminAppearanceExperiment({ user, ranking }: {
  user: User
  ranking: AppearanceExperimentRanking[]
}) {
  return (
    <Layout user={user} title="appearance experiment">
      <PageHeading className="admin-header" eyebrow="analytics" title="appearance experiment"
        action={<a className="profile-edit-link" href="/admin">back</a>} />
      {(['theme', 'accent', 'font', 'corners'] as const).map(category => {
        const rows = ranking.filter(row => row.category === category)
        return (
          <section className="admin-section appearance-experiment-ranking" key={category}>
            <h2>{category}</h2>
            {rows.length
              ? (
                <div className="appearance-experiment-table-wrap">
                  <table className="appearance-experiment-table">
                    <thead><tr>
                      <th scope="col">setting</th><th scope="col">total visits</th><th scope="col">median</th>
                      <th scope="col">average</th><th scope="col">users</th>
                    </tr></thead>
                    <tbody>{rows.map(row => (
                      <tr key={row.value}>
                        <th scope="row">{row.label}</th>
                        <td>{row.pageVisits.toLocaleString()}</td>
                        <td>{row.medianPageVisits.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td>{row.averagePageVisits.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td>{row.users.toLocaleString()}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )
              : <p className="section-empty">No assignments yet.</p>}
          </section>
        )
      })}
    </Layout>
  )
}
