import { Post, ThreadReplies } from './post'

import type { PostView } from '../types'
import { Layout } from './layout'
import { postTitle } from './page-shared'

export function PublicThread(
  { post, social }: { post: PostView; social?: { description: string; image: string; url: string } },
) {
  return (
    <Layout title={postTitle(post.body)} social={social}>
      <div className="thread-root">
        <Post p={post} user={null} replyHref={'/login?next=' + encodeURIComponent('/post/' + post.id + '?reply=1')}
          replyLabel="log in to reply" />
      </div>
      <ThreadReplies parentId={post.id} user={null} />
    </Layout>
  )
}
