import { type User } from '../db'
import { CONNECTION_PAGE_SIZE, PAGE_SIZE } from '../pagination'
import type { PersonView, ProfileRow } from '../types'
import { Layout } from './layout'
import { BlockedPeopleList, BlockedTagList, ConnectionPeople, Pagination, ProfileHeader, ProfileTabs,
  TagPeopleList } from './page-shared'

export function Connections(
  { user, profile, people, tags = [], kind, page, total, noteCount, followerCount, followingCount, followingTagCount,
    following, social, blockedPeopleCount = 0, blockedTagCount = 0 }: {
      user: User | null
      profile: ProfileRow
      people: PersonView[]
      tags?: { tag: string; count: number; viewerFollowing: boolean }[]
      kind: 'following' | 'followers' | 'blocked'
      page: number
      total: number
      noteCount: number
      followerCount: number
      followingCount: number
      followingTagCount: number
      following: boolean
      blockedPeopleCount?: number
      blockedTagCount?: number
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} followers={followerCount}
        following={followingCount} followingTags={followingTagCount} showBlocked={user?.id === profile.id}
        blockedPeople={blockedPeopleCount} blockedTags={blockedTagCount} />
      {(kind === 'following' || kind === 'blocked') && (people.length || tags.length)
        ? (
          <div className="columns connections-columns">
            <section>
              <h2>Tags</h2>
              {tags.length
                ? kind === 'blocked'
                  ? <BlockedTagList tags={tags} />
                  : <TagPeopleList user={user} tags={tags} followingKey="viewerFollowing" />
                : (
                  <div className="empty connections-empty">
                    {kind === 'blocked'
                      ? 'You haven’t blocked any tags yet.'
                      : user?.id === profile.id
                      ? 'You haven’t followed any tags yet.'
                      : 'No followed tags yet.'}
                  </div>
                )}
            </section>
            <section>
              <h2>People</h2>
              {people.length
                ? kind === 'blocked'
                  ? <BlockedPeopleList people={people} />
                  : <ConnectionPeople user={user} people={people} />
                : (
                  <div className="empty connections-empty">
                    {kind === 'blocked'
                      ? 'You haven’t blocked anyone yet.'
                      : user?.id === profile.id
                      ? 'You haven’t followed anyone yet.'
                      : 'No followed people yet.'}
                  </div>
                )}
            </section>
          </div>
        )
        : people.length
        ? <ConnectionPeople user={user} people={people} className="connections-list" />
        : (
          <div className={`empty${user?.id === profile.id && kind === 'following' ? ' empty-actions' : ''}`}>
            {user?.id === profile.id && kind === 'following'
              ? (
                <>
                  <p>You aren’t following anyone or any tags yet.</p>
                  <a className="button" href="/explore">explore tags &amp; people</a>
                </>
              )
              : user?.id === profile.id
              ? kind === 'blocked'
                ? 'You haven’t blocked anyone or any tags.'
                : 'You don’t have any followers yet.'
              : <>@{profile.handle} {kind === 'following' ? 'isn’t following anyone yet.' : 'has no followers yet.'}</>}
          </div>
        )}
      <Pagination page={page} totalPages={Math.ceil(total / (kind === 'blocked' ? PAGE_SIZE : CONNECTION_PAGE_SIZE))}
        path={`/u/${profile.handle}?tab=${kind}`} />
    </Layout>
  )
}
