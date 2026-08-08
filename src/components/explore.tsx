import { db, type User } from '../db'
import { suggestedPeople, trendingTags } from '../explore'
import type { PersonView } from '../types'
import { Layout } from './layout'
import { ActionPair, TagPeopleList } from './page-shared'

export function Explore({ user, welcome = false, peopleIds }: {
  user: User | null
  welcome?: boolean
  peopleIds?: number[]
}) {
  const viewerId = user?.id ?? -1
  const savedIds = peopleIds?.filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index)
    .slice(0, 6)
  const people = savedIds?.length
    ? (db.query(
      `SELECT u.*, (SELECT count(*) FROM posts p WHERE p.user_id=u.id AND p.deleted_at IS NULL) posts,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=u.id) following
        FROM users u WHERE u.id IN (${savedIds.map(() => '?').join(',')}) AND u.deleted_at IS NULL
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)))`,
    ).all(viewerId, ...savedIds, viewerId, viewerId, viewerId) as PersonView[])
      .sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id))
    : suggestedPeople(db, viewerId)
  const explorePeople = people.map(p => p.id).join(',')
  const tags = trendingTags(db, viewerId)
  return (
    <Layout user={user} title="explore">
      {user && welcome && (
        <section className="welcome-panel" role="status">
          <p className="eyebrow">welcome to textlog</p>
          <h1>Make this place yours.</h1>
          <p>Follow a few people or hashtags below, or start with a note of your own.</p>
          <ActionPair className="welcome-actions"
            primary={<a className="button" href="/write">write your first note →</a>}
            secondary={<a href="/">browse notes</a>}
          />
        </section>
      )}
      <div className="columns">
        <section>
          <h2>Trending tags</h2>
          {tags.length
            ? <TagPeopleList user={user} tags={tags} />
            : <p className="section-empty">No hashtags yet.</p>}
        </section>
        <section>
          <h2>{user ? 'People to follow' : 'People'}</h2>
          <div className="people">
            {people.map(p => (
              <article key={p.id}>
                <div>
                  <div>
                    <a href={'/u/' + p.handle}>@{p.handle}</a>
                    <small>{p.posts} {p.posts === 1 ? 'note' : 'notes'}</small>
                  </div>
                  {user && (
                    <form method="post" action={'/follow/' + p.handle}>
                      <input type="hidden" name="explorePeople" value={explorePeople} />
                      <button className={`button${p.following ? ' unfollow-button' : ''}`}>
                        {p.following ? 'unfollow' : 'follow'}
                      </button>
                    </form>
                  )}
                </div>
                <p className="profile-bio">{p.bio || 'No bio yet.'}</p>
              </article>
            ))}
            {!people.length && <p className="section-empty">No people to suggest yet.</p>}
          </div>
        </section>
      </div>
    </Layout>
  )
}
