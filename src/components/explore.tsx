import { appName } from '../brand'
import { EXPLORE_TAG_PAGE_SIZE } from '../pagination'
import type { ExploreData, User } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { ActionPair, Pagination, paginationHeadingClass, TagChips } from './page-shared'
import { Panel } from './panel'
import { BioReferenceForms, UserReference } from './post'
import { SearchForm } from './search'
import { writeHref } from './write-link'

const PEOPLE_PAGE_SIZE = 8

export function Explore({ user, welcome = false, tagsPage = 1, peoplePage = 1, data }: {
  user: User | null
  welcome?: boolean
  tagsPage?: number
  peoplePage?: number
  data: ExploreData
}) {
  const { people, tags, peopleTotal, tagsTotal, profileStats } = data
  const explorePeople = people.map(p => p.id).join(',')
  const tagsPath = `/explore${peoplePage > 1 ? `?peoplePage=${peoplePage}` : ''}`
  const peoplePath = `/explore${tagsPage > 1 ? `?tagsPage=${tagsPage}` : ''}`
  const explorePath = () => {
    const query = new URLSearchParams()
    if (tagsPage > 1) query.set('tagsPage', String(tagsPage))
    if (peoplePage > 1) query.set('peoplePage', String(peoplePage))
    return `/explore${query.size ? `?${query}` : ''}`
  }
  const exploreReturnPath = (personId: number) => {
    return `${explorePath()}#person-${personId}`
  }
  return (
    <Layout user={user} title="explore">
      {user && welcome && (
        <Panel as="section" width="fluid" className="welcome-panel" role="status">
          <form className="welcome-dismiss" method="post" action="/explore/welcome/dismiss">
            <button type="submit" aria-label="Dismiss welcome">
              <span aria-hidden="true" />
            </button>
          </form>
          <p className="eyebrow">welcome to {appName()}</p>
          <h1>Make this place yours.</h1>
          <p>Follow a few people or hashtags below, or start with a note of your own.</p>
          <ActionPair className="welcome-actions"
            primary={<a className="button" href={writeHref()}>write your first note →</a>}
            secondary={<a href="/">browse notes</a>} />
          <nav className="welcome-settings" aria-label="Set up your account">
            <span>
              <a className="button" href="/account/edit/notifications">enable notifications</a>
              <a className="button" href="/account/edit/appearance">customize appearance</a>
            </span>
            <span>
              <a className="button" href="/account/edit/invite">invite friends</a>
              <a className="button" href="/account/password/enable">set up a password</a>
            </span>
          </nav>
        </Panel>
      )}
      {!welcome && (
        <section className="explore-search" aria-labelledby="explore-search-heading">
          <h1 id="explore-search-heading">Search</h1>
          <SearchForm placeholder="search notes, tags or people" />
        </section>
      )}
      <div className="explore-content">
        <section className="explore-tags" id="explore-tags">
          <div className={paginationHeadingClass()}>
            <h2>Trending tags</h2>
            <Pagination page={tagsPage} totalPages={Math.ceil(tagsTotal / EXPLORE_TAG_PAGE_SIZE)} path={tagsPath}
              pageParam="tagsPage" label="Tags pagination" compact anchor="explore-tags" instantScroll />
          </div>
          {tags.length
            ? <TagChips user={user} tags={tags} returnPath={`${explorePath()}#explore-tags`} showTagLinks />
            : <p className="section-empty">No hashtags yet.</p>}
        </section>
        <section className="explore-people" id="explore-people">
          <div className={paginationHeadingClass()}>
            <h2>{user ? 'People to follow' : 'People'}</h2>
            <Pagination page={peoplePage} totalPages={Math.ceil(peopleTotal / PEOPLE_PAGE_SIZE)} path={peoplePath}
              pageParam="peoplePage" label="People pagination" compact anchor="explore-people" instantScroll />
          </div>
          <div className="people">
            {people.map(p => (
              <article key={p.id} id={`person-${p.id}`}>
                <div>
                  <div>
                    <UserReference handle={p.handle} mood={p.mood} bio={p.bio} noteCount={p.posts}
                      stats={profileStats[p.id]} following={p.following} user={user} followsViewer={p.followsViewer}
                      showPopover={false} href={`/u/${p.handle}?from=${encodeURIComponent(exploreReturnPath(p.id))}`}
                      navigationQuery={`?from=${encodeURIComponent(exploreReturnPath(p.id))}`} />
                    {p.bio?.trim() && (
                      <p className="profile-bio" dangerouslySetInnerHTML={{
                        __html: linkify(displayBio(p.bio), p.bioReference?.mentionBios || {}, [], undefined, undefined,
                          '', p.bioReference?.hashtagCounts || {}, p.bioReference?.mentionNoteCounts || {}, {
                          signedIn: !!user,
                          currentHandle: user?.handle,
                          formPrefix: `explore-person-${p.id}-bio`,
                          linkPreviews: p.bioLinkPreviews,
                          mentionFollowing: p.bioReference?.mentionFollowing,
                          mentionFollowsViewer: p.bioReference?.mentionFollowsViewer,
                          mentionProfileStats: p.bioReference?.mentionProfileStats,
                          hashtagFollowing: p.bioReference?.hashtagFollowing,
                          hashtagFollowerCounts: p.bioReference?.hashtagFollowerCounts,
                        }),
                      }} />
                    )}
                  </div>
                  {user && (
                    <form method="post" action={'/follow/' + p.handle}>
                      <input type="hidden" name="explorePeople" value={explorePeople} />
                      <input type="hidden" name="from" value={exploreReturnPath(p.id)} />
                      {!!p.followsViewer && <span className="follows-you">follows you</span>}
                      <button className={`button${p.following ? ' button-muted' : ''}`}>
                        {p.following ? 'unfollow' : p.followsViewer ? 'follow back' : 'follow'}
                      </button>
                    </form>
                  )}
                </div>
                <BioReferenceForms data={p.bioReference} prefix={`explore-person-${p.id}-bio`} user={user} />
              </article>
            ))}
            {!people.length && <p className="section-empty">No people to suggest.</p>}
          </div>
          <Pagination page={peoplePage} totalPages={Math.ceil(peopleTotal / PEOPLE_PAGE_SIZE)} path={peoplePath}
            pageParam="peoplePage" label="People pagination" compact anchor="explore-people" instantScroll />
        </section>
      </div>
    </Layout>
  )
}
