import { Post, ThreadReplies } from './post'

import type { PostView } from '../types'
import { Layout } from './layout'
import { postTitle } from './page-shared'

export function PublicThread(
  { post, replies = [], social, returnPath, topHref }: { post: PostView; replies?: PostView[];
    social?: { title?: string; description: string; image: string; url: string };
    returnPath?: string; topHref?: string },
) {
  return (
    <Layout title={postTitle(post.body)} social={social}>
      <div className="post-page-thread">
        <div className="thread-root">
          <Post p={post} user={null} replyHref={'/enter?next=' + encodeURIComponent('/post/' + post.id + '?reply=1'
            + (returnPath ? '&from=' + encodeURIComponent(returnPath) : ''))} replyLabel="enter to reply" tappableParent
            backHref={returnPath} canonicalTimestamp topHref={topHref} />
        </div>
        <ThreadReplies parentId={post.id} replies={replies} user={null} returnPath={returnPath} />
      </div>
    </Layout>
  )
}
