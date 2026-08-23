import type { User } from '../types'
import type { PostRow, PostView } from '../types'
import { Layout } from './layout'
import type { PostingSuggestionSearch } from './page-shared'
import { Post, PreviewPost, ThreadReplies } from './post'
import { ReplyBox, ReplyPreview } from './reply'

export function EditPost(
  { user, post, parent, replies = [], error, body = post.body, preview = false, returnPath, suggestionSearch }: {
    user: User
    post: PostRow
    parent?: PostView | null
    replies?: PostView[]
    error?: string
    body?: string
    preview?: boolean
    returnPath?: string
    suggestionSearch?: PostingSuggestionSearch | null
  },
) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return (
    <Layout user={user} title="edit post">
      <div className={post.parent_id && parent ? 'post-page-thread' : undefined}>
        {post.parent_id && parent && (
          <div className="thread-root">
            <Post p={parent} user={user} showReplyAction={false} showOwnerActions showModerateAction tappableParent
              returnPath={returnPath} backHref={returnPath} showReadAction={false} />
          </div>
        )}
        {preview && post.parent_id && parent && <ReplyPreview parent={parent} user={user} body={body} />}
        {preview && !post.parent_id && (
          <div className="compose-post-preview">
            <h2>preview</h2>
            <PreviewPost p={{ ...post, body, handle: user.handle, bio: user.bio }} />
          </div>
        )}
        <ReplyBox action={'/post/' + post.id + '/edit'} body={body} error={error} suggestionSearch={suggestionSearch}
          className={post.parent_id && parent ? 'replybox' : 'compose edit-post-compose'}
          hidden={returnPath && <input type="hidden" name="from" value={returnPath} />}
          beforeTextarea={
            <div className="edit-post-delete-action">
              <a className="secondary-action danger" href={'/post/' + post.id + '/delete' + returnQuery}>
                delete note
              </a>
            </div>
          } secondary={
          <span className="edit-post-actions">
            <a className="secondary-action cancel-action edit-post-cancel" href={'/post/' + post.id + returnQuery}>
              cancel
            </a>
          </span>
        } primary={
          <span className="edit-post-primary-actions">
            <button className="secondary-action" name="action" value="preview">preview</button>
            <button className="button">save →</button>
          </span>
        } />
        {post.parent_id && parent && (
          <ThreadReplies parentId={parent.id} replies={replies} user={user} returnPath={returnPath}
            excludePostId={post.id} />
        )}
      </div>
    </Layout>
  )
}
