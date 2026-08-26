import { CONNECTION_PAGE_SIZE, PAGE_SIZE, TAG_PAGE_SIZE } from '../pagination'
import type { BioReferenceData, User } from '../types'
import type { PersonView, ProfileRow } from '../types'
import { Layout } from './layout'
import {
  BlockedPeopleList,
  BlockedTagList,
  ConnectionPeople,
  Pagination,
  paginationHeadingClass,
  ProfileHeader,
  ProfileTabs,
} from './page-shared'

export function Connections(
  { user, profile, people, tags = [], kind, page, total, tagsPage = 1, tagsTotal = 0, sort = 'recent', noteCount,
    followerCount, followingCount, followingTagCount, following, followsViewer = false, social, replyCount = 0,
    blockedPeopleCount = 0, blockedTagCount = 0, returnPath, bioReference }: {
      user: User | null
      profile: ProfileRow
      people: PersonView[]
      tags?: { tag: string; count: number; viewerFollowing: boolean }[]
      kind: 'following' | 'followers' | 'blocked'
      sort?: 'abc' | 'recent'
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
      bioReference?: BioReferenceData
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  const withFrom = (path: string) =>
    returnPath
      ? `${path}${path.includes('?') ? '&' : '?'}from=${encodeURIComponent(returnPath)}`
      : path
  const sortQuery = sort === 'abc' && user?.id === profile.id && kind !== 'blocked' ? '&sort=abc' : ''
  const sortToggle = user?.id === profile.id && kind !== 'blocked' && (
    <a
      href={withFrom(
        `/u/${profile.handle}?tab=${kind}${sort === 'recent' ? '&sort=abc' : ''}${
          kind === 'following' && tagsPage > 1 ? `&tagsPage=${tagsPage}` : ''
        }`,
      )}
    >
      {sort === 'recent' ? 'abc' : 'recent'}
    </a>
  )
  const connectionReturnPath = (anchor: string) =>
    withFrom(
      `/u/${profile.handle}?tab=${kind}${sortQuery}${page > 1 ? `&page=${page}` : ''}${
        kind === 'following' && tagsPage > 1 ? `&tagsPage=${tagsPage}` : ''
      }`,
    ) + anchor
  return (
    <Layout user={user} title={`${kind} @${profile.handle}`} social={social}>
      <ProfileHeader user={user} profile={profile} following={following} followsViewer={followsViewer}
        returnPath={returnPath} bioReference={bioReference} />
      <ProfileTabs profile={profile} active={kind} notes={noteCount} replies={replyCount} followers={followerCount}
        following={followingCount} followingTags={followingTagCount} showBlocked={user?.id === profile.id}
        blockedPeople={blockedPeopleCount} blockedTags={blockedTagCount} returnPath={returnPath} />
      {(kind === 'following' || kind === 'blocked') && (people.length || tags.length)
        ? (
          <div className={`columns connections-columns${kind === 'following' ? ' connections-columns-stacked' : ''}`}>
            <section>
              {kind === 'following'
                ? (
                  <div className={paginationHeadingClass()}>
                    <h2 id="connections-tags-heading">Tags</h2>
                    <Pagination page={tagsPage} totalPages={Math.ceil(tagsTotal / TAG_PAGE_SIZE)} path={withFrom(
                      `/u/${profile.handle}?tab=following${sortQuery}${page > 1 ? `&page=${page}` : ''}`,
                    )} pageParam="tagsPage" label="Tags pagination" compact anchor="connections-tags-heading" />
                  </div>
                )
                : <h2 id="connections-tags-heading">Tags</h2>}
              {tags.length
                ? kind === 'blocked'
                  ? <BlockedTagList user={user!} tags={tags} />
                  : (
                    <div className="explore-tag-chips">
                      {tags.map(tag => (
                        <div className="explore-tag-card" key={tag.tag} id={`tag-${tag.tag}`}>
                          {user
                            ? (
                              <form method="post" action={`/tag-follow/${encodeURIComponent(tag.tag)}`}>
                                <input type="hidden" name="from" value={connectionReturnPath(`#tag-${tag.tag}`)} />
                                <button
                                  className={`button explore-tag-chip${tag.viewerFollowing ? ' button-muted' : ''}`}
                                  aria-pressed={!!tag.viewerFollowing}
                                  title={`${tag.viewerFollowing ? 'Unfollow' : 'Follow'} #${tag.tag}`}
                                >
                                  #{tag.tag}
                                </button>
                              </form>
                            )
                            : (
                              <a className="button explore-tag-chip"
                                href={`/tag/${encodeURIComponent(tag.tag)}?from=${
                                  encodeURIComponent(connectionReturnPath(`#tag-${tag.tag}`))
                                }`}
                              >
                                #{tag.tag}
                              </a>
                            )}
                          <a className="explore-tag-link"
                            href={`/tag/${encodeURIComponent(tag.tag)}?from=${
                              encodeURIComponent(connectionReturnPath(`#tag-${tag.tag}`))
                            }`} title={`View #${tag.tag}`} aria-label={`View #${tag.tag}`} />
                        </div>
                      ))}
                    </div>
                  )
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
              <div className={paginationHeadingClass()}>
                <div className="connections-heading">
                  <h2 id="connections-people-heading">People</h2>
                  {sortToggle}
                </div>
                <Pagination page={page}
                  totalPages={Math.ceil(total / (kind === 'blocked' ? PAGE_SIZE : CONNECTION_PAGE_SIZE))}
                  path={withFrom(`/u/${profile.handle}?tab=${kind}${sortQuery}${
                    kind === 'following' && tagsPage > 1
                      ? `&tagsPage=${tagsPage}`
                      : ''
                  }`)} label="People pagination" compact anchor="connections-people-heading" />
              </div>
              {people.length
                ? kind === 'blocked'
                  ? <BlockedPeopleList user={user!} people={people} />
                  : (
                    <ConnectionPeople user={user} people={people} showNoteCount={false} showPopover={false}
                      returnPath={person => connectionReturnPath(`#person-${person.id}`)} />
                  )
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
                path={withFrom(`/u/${profile.handle}?tab=${kind}${sortQuery}${
                  kind === 'following' && tagsPage > 1
                    ? `&tagsPage=${tagsPage}`
                    : ''
                }`)} label="People pagination" compact anchor="connections-people-heading" />
            </section>
          </div>
        )
        : people.length
        ? (
          <>
            <div className="connections-heading connections-heading-wide">
              <h2 id="connections-people-heading">People</h2>
              {sortToggle}
            </div>
            <Pagination page={page} totalPages={Math.ceil(total / CONNECTION_PAGE_SIZE)}
              path={withFrom(`/u/${profile.handle}?tab=${kind}${sortQuery}`)} label="People pagination"
              anchor="connections-people-heading" />
            <ConnectionPeople user={user} people={people} className="connections-list connections-list-headed"
              showNoteCount={false} showPopover={false}
              returnPath={person => connectionReturnPath(`#person-${person.id}`)} />
            <Pagination page={page} totalPages={Math.ceil(total / CONNECTION_PAGE_SIZE)}
              path={withFrom(`/u/${profile.handle}?tab=${kind}${sortQuery}`)} label="People pagination"
              anchor="connections-people-heading" />
          </>
        )
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
      {kind === 'following' && !people.length && !tags.length && (
        <Pagination page={page} totalPages={Math.ceil(total / CONNECTION_PAGE_SIZE)} path={withFrom(
          `/u/${profile.handle}?tab=following${sortQuery}${tagsPage > 1 ? `&tagsPage=${tagsPage}` : ''}`,
        )} label="People pagination" compact anchor="connections-people-heading" />
      )}
    </Layout>
  )
}
