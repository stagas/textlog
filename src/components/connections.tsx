import { type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import type { PersonView, ProfileRow } from '../types'
import { Layout } from './layout'
import { ConnectionPeople, Pagination, ProfileHeader, ProfileTabs, TagPeopleList } from './page-shared'

export function Connections(
  { user, profile, people, tags = [], kind, page, total, noteCount, followerCount, followingCount, followingTagCount,
    following, social }: {
      user: User | null
      profile: ProfileRow
      people: PersonView[]
      tags?: { tag: string; count: number; viewerFollowing: boolean }[]
      kind: 'following' | 'followers'
      page: number
      total: number
      noteCount: number
      followerCount: number
      followingCount: number
      followingTagCount: number
      following: boolean
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} followers={followerCount}
        following={followingCount} followingTags={followingTagCount} />
      {kind === 'following' && (people.length || tags.length)
        ? (
          <div className="columns connections-columns">
            <section>
              <h2>Tags</h2>
              {tags.length
                ? <TagPeopleList user={user} tags={tags} followingKey="viewerFollowing" />
                : <div className="empty connections-empty">No followed tags yet.</div>}
            </section>
            <section>
              <h2>People</h2>
              {people.length
                ? <ConnectionPeople user={user} people={people} />
                : <div className="empty connections-empty">No followed people yet.</div>}
            </section>
          </div>
        )
        : people.length
        ? <ConnectionPeople user={user} people={people} className="connections-list" />
        : (
          <div className="empty">
            @{profile.handle} {kind === 'following' ? 'isn’t following anyone yet.' : 'has no followers yet.'}
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path={`/u/${profile.handle}?tab=${kind}`} />
    </Layout>
  )
}
