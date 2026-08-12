import { type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import type { PostView } from '../types'
import { Layout } from './layout'
import { Pagination } from './page-shared'
import { Post } from './post'

export function TagFeed(
  { user, tag, following, blocked = false, posts, page, total, social }: { user: User | null; tag: string;
    following: boolean; blocked?: boolean; posts: PostView[]; page: number; total: number;
    social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
      imageAlt?: string } },
) {
  return (
    <Layout user={user} title={`#${tag}`} social={social} feeds={{
      title: `#${tag} notes`,
      rss: `/tag/${encodeURIComponent(tag)}.rss`,
      atom: `/tag/${encodeURIComponent(tag)}.atom`,
    }}>
      <section className="page-header tag-header">
        <h1>
          <span>
            <span className="identity-prefix">#</span>
            {tag}
          </span>
          <span className="tag-note-count" aria-label={`${total} ${total === 1 ? 'note' : 'notes'}`}>
            {total}
          </span>
        </h1>
        {user
          ? (
            <div className="profile-action">
              <form method="post" action={'/tag-block/' + encodeURIComponent(tag)}>
                <button className={blocked ? 'button' : 'quiet danger'}>{blocked ? 'unblock' : 'block'}</button>
              </form>
              {!blocked && (
                <form method="post" action={'/tag-follow/' + encodeURIComponent(tag)}>
                  <button className={`button${following ? ' button-muted' : ''}`}>
                    {following ? 'unfollow' : 'follow'}
                  </button>
                </form>
              )}
            </div>
          )
          : <a className="button" href="/enter" rel="nofollow">enter to follow</a>}
      </section>
      {page > 1
        && <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path={'/tag/' + tag} top />}
      {blocked
        ? <div className="empty relationship-notice">You blocked this tag. Unblock it to see its notes.</div>
        : posts.length
        ? posts.map(post => <Post p={post} user={user} key={post.id} showReplyCount tappable />)
        : <div className="empty">No notes use this hashtag yet.</div>}
      <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path={'/tag/' + tag} />
    </Layout>
  )
}
