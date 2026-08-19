import { appName } from '../brand'
import { TAG_PAGE_SIZE } from '../pagination'
import type { ExploreData, User } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { ActionPair, Pagination, TagPeopleList } from './page-shared'
import { Panel } from './panel'
import { UserReference } from './post'
import { SearchForm } from './search'

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
    if (welcome) query.set('welcome', '1')
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
        <Panel as="section" width="wide" className="welcome-panel" role="status">
          <p className="eyebrow">welcome to {appName()}</p>
          <h1>Make this place yours.</h1>
          <p>Follow a few people or hashtags below, or start with a note of your own.</p>
          <ActionPair className="welcome-actions"
            primary={<a className="button" href="/write">write your first note →</a>}
            secondary={<a href="/">browse notes</a>} />
          <nav className="welcome-settings" aria-label="Set up your account">
            <span>
              <a href="/account/edit/notifications">enable notifications</a>
              <a href="/account/edit/appearance">customize appearance</a>
            </span>
            <span>
              <a href="/account/edit/invite">invite friends</a>
              <a href="/account/password/enable">set up a password</a>
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
      <div className="columns">
        <section>
          <h2>Trending tags</h2>
          {tags.length
            ? <TagPeopleList user={user} tags={tags} returnPath={tag => `${explorePath()}#tag-${tag.tag}`} />
            : <p className="section-empty">No hashtags yet.</p>}
          <Pagination page={tagsPage} totalPages={Math.ceil(tagsTotal / TAG_PAGE_SIZE)} path={tagsPath}
            pageParam="tagsPage" label="Tags pagination" compact />
        </section>
        <section>
          <h2>{user ? 'People to follow' : 'People'}</h2>
          <div className="people">
            {people.map(p => (
              <article key={p.id} id={`person-${p.id}`}>
                <div>
                  <div>
                    <UserReference handle={p.handle} bio={p.bio} noteCount={p.posts} stats={profileStats[p.id]}
                      following={p.following} user={user} followsViewer={p.followsViewer}
                      href={`/u/${p.handle}?from=${encodeURIComponent(exploreReturnPath(p.id))}`}
                      navigationQuery={`?from=${encodeURIComponent(exploreReturnPath(p.id))}`} />
                    <small>{p.posts} {p.posts === 1 ? 'note' : 'notes'}</small>
                  </div>
                  {user && (
                    <form method="post" action={'/follow/' + p.handle}>
                      <input type="hidden" name="explorePeople" value={explorePeople} />
                      <input type="hidden" name="from" value={exploreReturnPath(p.id)} />
                      {p.followsViewer && <span className="follows-you">follows you</span>}
                      <button className={`button${p.following ? ' button-muted' : ''}`}>
                        {p.following ? 'unfollow' : p.followsViewer ? 'follow back' : 'follow'}
                      </button>
                    </form>
                  )}
                </div>
                <p className="profile-bio" dangerouslySetInnerHTML={{ __html: linkify(displayBio(p.bio)) }} />
              </article>
            ))}
            {!people.length && <p className="section-empty">No people to suggest.</p>}
          </div>
          <Pagination page={peoplePage} totalPages={Math.ceil(peopleTotal / PEOPLE_PAGE_SIZE)} path={peoplePath}
            pageParam="peoplePage" label="People pagination" compact />
        </section>
      </div>
    </Layout>
  )
}
