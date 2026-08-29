import type { User } from '../types'
import type { LocationView, PostRow, PostView } from '../types'
import { Layout } from './layout'
import type { PostingSuggestionSearch } from './page-shared'
import { Post, PreviewPost, ThreadReplies } from './post'
import { ReplyBox, ReplyPreview } from './reply'

export function EditPost(
  { user, post, parent, replies = [], error, body = post.body, preview = false, returnPath, suggestionSearch,
    moderator = false, previewExecutionOutput, previewLocation }: {
      user: User
      post: PostRow & { handle?: string }
      parent?: PostView | null
      replies?: PostView[]
      error?: string
      body?: string
      preview?: boolean
      returnPath?: string
      suggestionSearch?: PostingSuggestionSearch | null
      moderator?: boolean
      previewExecutionOutput?: string | null
      previewLocation?: LocationView
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
        {preview && post.parent_id && parent && <ReplyPreview parent={parent} user={user} body={body}
          executionOutput={previewExecutionOutput} location={previewLocation} />}
        {preview && !post.parent_id && (
          <div className="compose-post-preview">
            <h2>preview</h2>
            <PreviewPost user={user} p={{ ...post, body, execution_output: previewExecutionOutput,
              location: previewLocation, handle: post.handle || user.handle, bio: moderator ? '' : user.bio }} />
          </div>
        )}
        <ReplyBox action={'/post/' + post.id + '/edit'} body={body} error={error} suggestionSearch={suggestionSearch}
          className={post.parent_id && parent
            ? 'replybox reply-compose edit-reply-compose'
            : 'compose edit-post-compose write-compose edit-write-compose'}
          hidden={returnPath && <input type="hidden" name="from" value={returnPath} />} beforeTextarea={!moderator
          && (
            <div className="edit-post-delete-action">
              <button className="secondary-action unpublish-action" name="action" value="unpublish" formNoValidate>
                draft
              </button>
              <a className="secondary-action danger" href={'/post/' + post.id + '/delete' + returnQuery}>
                delete
              </a>
            </div>
          )} secondary={
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
