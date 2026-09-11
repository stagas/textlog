import { CONNECTION_PAGE_SIZE, PAGE_SIZE } from '../pagination'
import type { User } from '../types'
import type { PersonView, PostView } from '../types'
import { enterHref } from './auth-links'
import { Layout } from './layout'
import { feedChunkReturnPath } from './infinite-feed'
import { ConnectionPeople, GuestCommunityActions, Pagination, TabHighlight } from './page-shared'
import { ThreadedFeedChunks } from './threaded-feed'

export function TagFeed(
  { user, tag, displayName, aliases = [], following, blocked = false, posts, page, total, followerTotal = 0,
    people = [], tab = 'notes', social, notePageSize = PAGE_SIZE, returnPath, expandedRootId, chunk = 0,
    initialChunks = 1 }: { user: User | null;
      tag: string;
      displayName?: string | null; aliases?: Array<{ tag: string; displayName: string | null }>; following: boolean;
      blocked?: boolean; posts: PostView[]; page: number; total: number; followerTotal?: number; people?: PersonView[];
      tab?: 'notes' | 'followers'; notePageSize?: number; returnPath?: string;
      expandedRootId?: number;
      chunk?: number; initialChunks?: number;
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
        imageAlt?: string } },
) {
  const tagPath = `/tag/${encodeURIComponent(tag)}`
  const tabPath = tab === 'followers' ? `${tagPath}?tab=followers` : tagPath
  const paginationPath = returnPath
    ? `${tabPath}${tabPath.includes('?') ? '&' : '?'}from=${encodeURIComponent(returnPath)}`
    : tabPath
  const feedPath = `${paginationPath}${page > 1 ? `${returnPath ? '&' : '?'}page=${page}` : ''}`
  const renderedChunk = chunk === 0 ? initialChunks - 1 : chunk
  const chunkReturnPath = feedChunkReturnPath(feedPath, renderedChunk)
  const threadMarkup = <ThreadedFeedChunks posts={posts} user={user} returnPath={chunkReturnPath} chunk={chunk}
    initialChunks={initialChunks} expandedRootId={expandedRootId} />
  if (chunk > 0) return threadMarkup
  return (
    <Layout user={user} title={`#${tag}`} social={social} feeds={{
      title: `#${tag} notes`,
      rss: `/tag/${encodeURIComponent(tag)}.rss`,
      atom: `/tag/${encodeURIComponent(tag)}.atom`,
    }}>
      <section className={`page-header tag-header${returnPath ? ' tag-header-contextual' : ''}`}>
        <div className="tag-title-actions">
          <div className="tag-heading-block">
            <h1>
              <a className="tag-canonical-link" href={tagPath}>
                <span className="identity-prefix">#</span>
                {displayName || tag}
              </a>
            </h1>
            {!!aliases.length && (
              <p className="tag-aliases">{aliases.map(alias => `#${alias.displayName || alias.tag}`).join(', ')}</p>
            )}
          </div>
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
                  <button className={`quiet danger${blocked ? ' quiet-accent' : ''}`}>
                    {blocked ? 'unblock' : 'block'}
                  </button>
                </form>
              </div>
            )
            : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>}
        </div>
        {returnPath && <a className="profile-edit-link tag-back-link" href={returnPath}>back</a>}
      </section>
      <nav className="feed-tabs profile-tabs" aria-label={`#${tag} tag`}>
        <div className="feed-tabs-scroll">
          <a className={tab === 'notes' ? 'active' : ''} aria-current={tab === 'notes' ? 'page' : undefined}
            href={`${tagPath}${returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''}`}
          >
            <TabHighlight active={tab === 'notes'} />
            notes
          </a>
          <a className={tab === 'followers' ? 'active' : ''} aria-current={tab === 'followers' ? 'page' : undefined}
            href={`${tagPath}?tab=followers${returnPath ? `&from=${encodeURIComponent(returnPath)}` : ''}`}
          >
            <TabHighlight active={tab === 'followers'} />
            followers
          </a>
        </div>
      </nav>
      <div data-feed-view>
        {page > 1
          && (
            <Pagination page={page} totalPages={Math.ceil((tab === 'followers' ? followerTotal : total)
              / (tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize))} path={paginationPath} top />
          )}
        {tab === 'followers'
        ? people.length
          ? (
            <ConnectionPeople user={user} people={people} className="connections-list" showNoteCount={false}
              returnPath={person => `${paginationPath}${page > 1 ? '&page=' + page : ''}#person-${person.id}`} />
          )
          : <div className="empty">No one follows this tag yet.</div>
        : blocked
        ? (
          <div className="empty relationship-notice">
            You blocked this tag.{' '}
            <form method="post" action={'/tag-block/' + encodeURIComponent(tag)}>
              <button className="relationship-notice-action">Unblock it</button>
            </form>{' '}
            to see its notes.
          </div>
        )
        : posts.length
        ? threadMarkup
        : <div className="empty">No notes use this hashtag yet.</div>}
        <Pagination page={page} totalPages={Math.ceil((tab === 'followers' ? followerTotal : total)
          / (tab === 'followers' ? CONNECTION_PAGE_SIZE : notePageSize))} path={paginationPath} />
      </div>
      {!user && <GuestCommunityActions className="post-page-actions" />}
    </Layout>
  )
}
