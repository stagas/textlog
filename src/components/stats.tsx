import type { User } from '../db'
import type { DashboardStats } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'

const labels: [keyof DashboardStats, string][] = [
  ['users', 'users'],
  ['usersOnline', 'users online · 30m'],
  ['anonymousOnline', 'anonymous online · 30m'],
  ['suspendedUsers', 'suspended'],
  ['activePosts', 'active posts'],
  ['replies', 'replies'],
  ['visitorsToday', 'unique visitors · today'],
  ['visitorsYesterday', 'unique visitors · yesterday'],
  ['visitors7d', 'visitor-days · 7d'],
  ['activeUsersYesterday', 'active users · yesterday'],
  ['usersYesterday', 'new users · yesterday'],
  ['users24h', 'new users · 24h'],
  ['users7d', 'new users · 7d'],
  ['postsYesterday', 'new posts · yesterday'],
  ['posts24h', 'new posts · 24h'],
  ['posts7d', 'new posts · 7d'],
]

export function StatsGrid({ stats, publicOnly = false }: { stats: DashboardStats; publicOnly?: boolean }) {
  const visibleLabels = publicOnly
    ? labels.filter(([key]) => !['suspendedUsers', 'usersOnline', 'anonymousOnline'].includes(key))
    : labels
  return (
    <section className="admin-stats" aria-label="Application statistics">
      {visibleLabels.map(([key, label]) => (
        <article key={key}>
          <strong>{stats[key].toLocaleString()}</strong>
          <span>{label}</span>
        </article>
      ))}
    </section>
  )
}

export function Stats({ user, stats }: { user: User | null; stats: DashboardStats }) {
  return (
    <Layout user={user} title="stats">
      <PageHeading className="admin-header" eyebrow="community" title="stats" />
      <StatsGrid stats={stats} publicOnly />
    </Layout>
  )
}
