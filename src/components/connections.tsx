import type { User } from '../types'
import { CONNECTION_PAGE_SIZE, PAGE_SIZE, TAG_PAGE_SIZE } from '../pagination'
import type { PersonView, ProfileRow } from '../types'
import { Layout } from './layout'
import { BlockedPeopleList, BlockedTagList, ConnectionPeople, Pagination, ProfileHeader, ProfileTabs,
  TagPeopleList } from './page-shared'

export function Connections(
  { user, profile, people, tags = [], kind, page, total, tagsPage = 1, tagsTotal = 0, noteCount, followerCount,
    followingCount, followingTagCount, following, followsViewer = false, social, replyCount = 0,
    blockedPeopleCount = 0, blockedTagCount = 0,
    returnPath }: {
      user: User | null
      profile: ProfileRow
      people: PersonView[]
      tags?: { tag: string; count: number; viewerFollowing: boolean }[]
      kind: 'following' | 'followers' | 'blocked'
      page: number
      total: number
      tagsPage?: number
      tagsTotal?: number
      noteCount: number
      replyCount?: number
      followerCount: number
      followingCount: number
      followingTagCount: number
      following: boolean
      followsViewer?: boolean
      blockedPeopleCount?: number
      blockedTagCount?: number
      returnPath?: string
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  const withFrom = (path: string) =>
    returnPath
      ? `${path}${path.includes('?') ? '&' : '?'}from=${encodeURIComponent(returnPath)}`
      : path
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} followsViewer={followsViewer}
        returnPath={returnPath} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} replies={replyCount} followers={followerCount}
        following={followingCount} followingTags={followingTagCount} showBlocked={user?.id === profile.id}
        blockedPeople={blockedPeopleCount} blockedTags={blockedTagCount} returnPath={returnPath} />
      {(kind === 'following' || kind === 'blocked') && (people.length || tags.length)
        ? (
          <div className="columns connections-columns">
            <section>
              <h2>Tags</h2>
              {tags.length
                ? kind === 'blocked'
                  ? <BlockedTagList user={user!} tags={tags} />
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
              {kind === 'following' && (
                <Pagination page={tagsPage} totalPages={Math.ceil(tagsTotal / TAG_PAGE_SIZE)}
                  path={withFrom(`/u/${profile.handle}?tab=following${page > 1 ? `&page=${page}` : ''}`)}
                  pageParam="tagsPage" label="Tags pagination" compact />
              )}
            </section>
            <section>
              <h2>People</h2>
              {people.length
                ? kind === 'blocked'
                  ? <BlockedPeopleList user={user!} people={people} />
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
              <Pagination page={page}
                totalPages={Math.ceil(total / (kind === 'blocked' ? PAGE_SIZE : CONNECTION_PAGE_SIZE))}
                path={withFrom(`/u/${profile.handle}?tab=${kind}${
                  kind === 'following' && tagsPage > 1
                    ? `&tagsPage=${tagsPage}`
                    : ''
                }`)} label="People pagination" compact />
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
      {kind !== 'following' && kind !== 'blocked' && (
        <Pagination page={page} totalPages={Math.ceil(total / CONNECTION_PAGE_SIZE)}
          path={withFrom(`/u/${profile.handle}?tab=${kind}`)} />
      )}
      {kind === 'following' && !people.length && !tags.length && (
        <Pagination page={page} totalPages={Math.ceil(total / CONNECTION_PAGE_SIZE)}
          path={withFrom(`/u/${profile.handle}?tab=following${tagsPage > 1 ? `&tagsPage=${tagsPage}` : ''}`)}
          label="People pagination" compact />
      )}
    </Layout>
  )
}
