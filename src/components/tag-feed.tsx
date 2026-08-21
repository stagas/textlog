import { CONNECTION_PAGE_SIZE, PAGE_SIZE } from '../pagination'
import type { User } from '../types'
import type { PersonView, PostView } from '../types'
import { enterHref } from './auth-links'
import { Layout } from './layout'
import { ConnectionPeople, Pagination } from './page-shared'
import { Post } from './post'

export function TagFeed(
  { user, tag, following, blocked = false, posts, page, total, followerTotal = 0, people = [], tab = 'notes', social,
    notePageSize = PAGE_SIZE, returnPath }: { user: User | null; tag: string; following: boolean; blocked?: boolean;
      posts: PostView[]; page: number; total: number; followerTotal?: number; people?: PersonView[];
      tab?: 'notes' | 'followers'; notePageSize?: number; returnPath?: string;
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
        imageAlt?: string } },
) {
  const tagPath = `/tag/${encodeURIComponent(tag)}`
  const tabPath = tab === 'followers' ? `${tagPath}?tab=followers` : tagPath
  const paginationPath = returnPath
    ? `${tabPath}${tabPath.includes('?') ? '&' : '?'}from=${encodeURIComponent(returnPath)}`
    : tabPath
  const feedPath = `${paginationPath}${page > 1 ? `${returnPath ? '&' : '?'}page=${page}` : ''}`
  return (
    <Layout user={user} title={`#${tag}`} social={social} feeds={{
      title: `#${tag} notes`,
      rss: `/tag/${encodeURIComponent(tag)}.rss`,
      atom: `/tag/${encodeURIComponent(tag)}.atom`,
    }}>
      <section className={`page-header tag-header${returnPath ? ' tag-header-contextual' : ''}`}>
        <div className="tag-title-actions">
          <h1>
            <a className="tag-canonical-link" href={tagPath}>
              <span className="identity-prefix">#</span>
              {tag}
            </a>
          </h1>
          {user
            ? (
              <div className="profile-action tag-handle-actions">
                {!blocked && (
                  <form method="post" action={'/tag-follow/' + encodeURIComponent(tag)}>
                    <button className={`button${following ? ' button-muted' : ''}`}>
                      {following ? 'unfollow' : 'follow'}
                    </button>
                  </form>
                )}
                <form method="post" action={'/tag-block/' + encodeURIComponent(tag)}>
                  <button className={blocked ? 'button' : 'quiet danger'}>{blocked ? 'unblock' : 'block'}</button>
                </form>
              </div>
            )
            : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>}
        </div>
        {returnPath && <a className="profile-edit-link tag-back-link" href={returnPath}>back</a>}
      </section>
      <nav className="feed-tabs profile-tabs" aria-label={`#${tag} tag`}>
        <a className={tab === 'notes' ? 'active' : ''} aria-current={tab === 'notes' ? 'page' : undefined}
          href={`${tagPath}${returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''}`}
        >
          notes
        </a>
        <a className={tab === 'followers' ? 'active' : ''} aria-current={tab === 'followers' ? 'page' : undefined}
          href={`${tagPath}?tab=followers${returnPath ? `&from=${encodeURIComponent(returnPath)}` : ''}`}
        >
          followers
        </a>
      </nav>
      {page > 1
        && (
          <Pagination page={page} totalPages={Math.ceil((tab === 'followers' ? followerTotal : total)
            / (tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize))} path={paginationPath} top />
        )}
      {tab === 'followers'
        ? people.length
          ? (
            <ConnectionPeople user={user} people={people} className="connections-list"
              returnPath={person => `${paginationPath}${page > 1 ? '&page=' + page : ''}#person-${person.id}`} />
          )
          : <div className="empty">No one follows this tag yet.</div>
        : blocked
        ? <div className="empty relationship-notice">You blocked this tag. Unblock it to see its notes.</div>
        : posts.length
        ? posts.map(post => (
          <Post p={post} user={user} key={post.id} showReplyCount tappable returnPath={`${feedPath}#post-${post.id}`} />
        ))
        : <div className="empty">No notes use this hashtag yet.</div>}
      <Pagination page={page} totalPages={Math.ceil((tab === 'followers' ? followerTotal : total)
        / (tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize))} path={paginationPath} />
    </Layout>
  )
}
