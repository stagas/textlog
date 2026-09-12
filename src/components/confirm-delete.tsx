import type { User } from '../types'
import type { PostRow } from '../types'
import { ConfirmActionPanel } from './confirm-action-panel'
import { Post } from './post'

export function ConfirmDelete({ user, post, returnPath }: { user: User; post: PostRow; returnPath?: string }) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return <ConfirmActionPanel user={user} pageTitle="delete post" eyebrow="note deletion" heading="Delete this post?"
    copy={<>This can’t be undone. Replies will remain, with this post shown as “(deleted post)” where the conversation
      needs it.</>} formAction={'/post/' + post.id + '/delete'} cancelHref={'/post/' + post.id + returnQuery}
    submitLabel="delete post" danger preview={
      <section className="confirm-delete-post" aria-label="Post to delete">
          <Post p={{ ...post, handle: user.handle, bio: user.bio }} user={user} showReadAction={false}
            suppressContentWarning />
      </section>
    }>
    {returnPath && <input type="hidden" name="from" value={returnPath} />}
  </ConfirmActionPanel>
}
