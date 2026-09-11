import type { User } from '../types'
import type { PostRow } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { Panel, PanelCopy, PanelHeading } from './panel'
import { Post } from './post'

export function ConfirmDelete({ user, post, returnPath }: { user: User; post: PostRow; returnPath?: string }) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return (
    <Layout user={user} title="delete post">
      <Panel className="confirm-delete admin-confirm">
        <p className="eyebrow">note deletion</p>
        <PanelHeading as="h1">Delete this post?</PanelHeading>
        <PanelCopy>
          This can’t be undone. Replies will remain, with this post shown as “(deleted post)” where the conversation
          needs it.
        </PanelCopy>
        <section className="confirm-delete-post" aria-label="Post to delete">
          <Post p={{ ...post, handle: user.handle, bio: user.bio }} user={user} showReadAction={false}
            suppressContentWarning />
        </section>
        <form method="post" action={'/post/' + post.id + '/delete'}>
          {returnPath && <input type="hidden" name="from" value={returnPath} />}
          <FormActions
            secondary={<a className="secondary-action cancel-action" href={'/post/' + post.id + returnQuery}>cancel</a>}
            primary={<button className="button button-danger" type="submit">delete post</button>}
          />
        </form>
      </Panel>
    </Layout>
  )
}
