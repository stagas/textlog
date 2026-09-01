import type { User } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { FormActions, FormMessage } from './page-shared'

export function AdminTags({ user, groups, error }: {
  user: User
  groups: Array<{ primaryTag: string; aliases: string[] }>
  error?: string
}) {
  return (
    <Layout user={user} title="tag aliases">
      <PageHeading className="admin-header" eyebrow="admin operations" title="tag aliases"
        description="Aliases share one tag page, follower list, and moderation state with their primary tag."
        action={<a className="profile-edit-link" href="/admin">dashboard</a>} />
      <section className="admin-tags-create">
        <FormMessage error={error ? `#${error} is already assigned to another tag group.` : undefined} />
        <form method="post" action="/admin/tags">
          <label className="form-label">
            primary tag
            <input className="form-control" name="primary" required maxLength={280} placeholder="meta"
              autoComplete="off" />
          </label>
          <label className="form-label">
            aliases
            <input className="form-control" name="aliases" required placeholder="tlog, textlog"
              autoComplete="off" />
          </label>
          <small className="admin-tags-hint">Separate multiple aliases with commas or spaces.</small>
          <FormActions primary={<button className="button">add aliases →</button>} />
        </form>
      </section>
      <section className="admin-section admin-tag-groups">
        <h2>tag groups <span>{groups.length}</span></h2>
        {groups.length
          ? groups.map(group => (
            <article key={group.primaryTag}>
              <a className="admin-tag-primary" href={`/tag/${encodeURIComponent(group.primaryTag)}`}>
                #{group.primaryTag}
              </a>
              <div className="admin-tag-group-content">
                <div className="admin-tag-aliases">
                  {group.aliases.map(alias => (
                    <form method="post" action={`/admin/tags/${encodeURIComponent(alias)}/remove`} key={alias}>
                      <span>#{alias}</span>
                      <button className="quiet danger" aria-label={`Remove #${alias} alias`}>remove</button>
                    </form>
                  ))}
                  <form className="admin-tag-quick-add" method="post" action="/admin/tags">
                    <input type="hidden" name="primary" value={group.primaryTag} />
                    <input name="aliases" required placeholder="add aliases"
                      aria-label={`Add aliases to #${group.primaryTag}`} autoComplete="off" />
                    <button className="quiet">add</button>
                  </form>
                </div>
              </div>
            </article>
          ))
          : <p className="section-empty">No tag aliases configured.</p>}
      </section>
    </Layout>
  )
}
