import { Post, ThreadReplies } from './post'

import type { PostView } from '../types'
import { Layout } from './layout'
import { ActionPair, postTitle } from './page-shared'

export function PublicThread(
  { post, replies = [], social, returnPath, topHref, flatHref, treeHref, flat = false }: { post: PostView;
    replies?: PostView[];
    social?: { title?: string; description: string; image: string; url: string }; returnPath?: string;
    topHref?: string; flatHref?: string; treeHref?: string; flat?: boolean },
) {
  return (
    <Layout title={postTitle(post.body)} social={social}>
      <div className="post-page-thread public-post-page-thread">
        <div className="thread-root">
          <Post p={post} user={null} replyHref={'/enter?next=' + encodeURIComponent('/post/' + post.id + '?reply=1'
            + (returnPath ? '&from=' + encodeURIComponent(returnPath) : ''))} replyLabel="enter to reply" tappableParent
            backHref={returnPath} canonicalTimestamp topHref={topHref} flatHref={flatHref} treeHref={treeHref} />
        </div>
        <ThreadReplies parentId={post.id} replies={replies} user={null} returnPath={returnPath} flat={flat} />
      </div>
      <ActionPair className="post-page-actions"
        primary={<a className="button" href="/enter" rel="nofollow">join the community</a>}
        secondary={<a href="/hot">browse more notes</a>} />
    </Layout>
  )
}
