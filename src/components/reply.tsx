import { type User } from '../db'
import { canPublishPosts } from '../posting-policy'
import type { PostView } from '../types'
import { Layout } from './layout'
import { FormMessage, postTitle, ReportPanel, VerificationRequired } from './page-shared'
import { Post, ThreadReplies } from './post'

export function Reply(
  { user, post, showForm, showReport = false, reported = false, error, body = '', social }: { user: User;
    post: PostView; showForm: boolean; showReport?: boolean; reported?: boolean; error?: string;
    social?: { description: string; image: string; url: string }; body?: string },
) {
  return (
    <Layout user={user} title={postTitle(post.body)} social={social}>
      <div className="thread-root">
        <Post p={post} user={user} showReplyAction={!showForm} showOwnerActions showModerateAction
          reportHref={user.id !== post.user_id && !showReport && !reported ? `/post/${post.id}?report=1` : undefined} />
      </div>
      {user.id !== post.user_id && <ReportPanel post={post} showForm={showReport} reported={reported} />}
      {showForm && (
        canPublishPosts(user)
          ? <div className="panel replybox">
          <form method="post" action={'/post/' + post.id + '/reply'}>
            <FormMessage error={error} />
            <textarea name="body" maxLength={280} required autoFocus defaultValue={body}
              placeholder={'Reply to @' + post.handle + '…'} />
            <div className="composefoot">
              <span>280 characters max</span>
              <button className="button">post →</button>
            </div>
          </form>
        </div>
          : <VerificationRequired />
      )}
      <ThreadReplies parentId={post.id} user={user} />
    </Layout>
  )
}
