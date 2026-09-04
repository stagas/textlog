import type { User } from '../types'
import type { DashboardStats } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'

type StatItem = [keyof DashboardStats, string]

const groups: Array<{ title: string; items: StatItem[] }> = [
  { title: 'Audience', items: [
    ['visitorsToday', 'unique visitors · today'],
    ['visitorsYesterday', 'unique visitors · yesterday'],
    ['visitors7d', 'visitor-days · 7d'],
    ['usersOnline', 'users online · 30m'],
    ['anonymousOnline', 'anonymous online · 30m'],
  ] },
  { title: 'Community', items: [
    ['users', 'users'],
    ['activeUsersYesterday', 'active users · yesterday'],
    ['dau', 'active users · 24h'],
    ['mau', 'active users · 1mo'],
    ['suspendedUsers', 'suspended users'],
  ] },
  { title: 'Publishing', items: [
    ['posts', 'total posts'],
    ['replies', 'total replies'],
    ['notesPerUser', 'median/avg notes per user'],
    ['postsYesterday', 'new posts · yesterday'],
    ['posts24h', 'new posts · 24h'],
    ['posts7d', 'new posts · 7d'],
  ] },
  { title: 'Growth', items: [
    ['usersYesterday', 'new users · yesterday'],
    ['users24h', 'new users · 24h'],
    ['users7d', 'new users · 7d'],
  ] },
  { title: 'Campaigns', items: [
    ['redditVisitors', 'unique visitors · reddit'],
    ['redditNewUsers', 'new users · reddit'],
  ] },
]

const privateStats: Array<keyof DashboardStats> = [
  'suspendedUsers', 'usersOnline', 'anonymousOnline', 'redditVisitors', 'redditNewUsers',
]

export function StatsGrid({ stats, publicOnly = false }: { stats: DashboardStats; publicOnly?: boolean }) {
  const conversionRateYesterday = stats.visitorsYesterday === 0
    ? 0
    : stats.usersYesterday / stats.visitorsYesterday * 100
  const signupActiveRateYesterday = stats.usersYesterday === 0
    ? 0
    : stats.activatedNewUsersYesterday / stats.usersYesterday * 100
  return (
    <section className="admin-stats" aria-label="Application statistics">
      {groups.map(group => {
        const items = publicOnly ? group.items.filter(([key]) => !privateStats.includes(key)) : group.items
        if (!items.length) return null
        return (
          <section className="admin-stat-group" key={group.title}>
            <h2>{group.title}</h2>
            <div className="admin-stat-grid">
              {items.map(([key, label]) => (
                <article key={key}>
                  <strong>
                    {key === 'notesPerUser'
                      ? `${stats.notesPerUser.toLocaleString(undefined, { maximumFractionDigits: 1 })}/${
                        stats.averageNotesPerUser.toLocaleString(undefined, { maximumFractionDigits: 1 })
                      }`
                      : stats[key].toLocaleString()}
                  </strong>
                  <span>{label}</span>
                </article>
              ))}
              {group.title === 'Growth' && (
                <>
                  <article>
                    <strong>{conversionRateYesterday.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</strong>
                    <span>Conversion rate · yesterday</span>
                  </article>
                  <article>
                    <strong>{signupActiveRateYesterday.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</strong>
                    <span>Signup-to-active conversion · yesterday</span>
                  </article>
                </>
              )}
            </div>
          </section>
        )
      })}
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
