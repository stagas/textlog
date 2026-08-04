import { type User } from '../db'
import { PAGE_SIZE } from '../pagination'
import type { PostView } from '../types'
import { Layout } from './layout'
import { Pagination } from './page-shared'
import { Post } from './post'

export function TagFeed(
  { user, tag, following, posts, page, total, social }: { user: User | null; tag: string; following: boolean;
    posts: PostView[]; page: number; total: number;
    social?: { description: string; image: string; url: string; type?: 'article' | 'profile' | 'website';
      imageAlt?: string } },
) {
  return (
    <Layout user={user} title={`#${tag}`} social={social}>
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
            <form method="post" action={'/tag-follow/' + tag}>
              <button className={`button${following ? ' unfollow-button' : ''}`}>
                {following ? 'unfollow' : 'follow'}
              </button>
            </form>
          )
          : <a className="button" href="/login">log in to follow</a>}
      </section>
      {posts.length
        ? posts.map(post => <Post p={post} user={user} key={post.id} />)
        : <div className="empty">No notes use this hashtag yet.</div>}
      <Pagination page={page} totalPages={Math.ceil(total / PAGE_SIZE)} path={'/tag/' + tag} />
    </Layout>
  )
}
