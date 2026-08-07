import { type User } from '../db'
import type { PostView, ProfileRow } from '../types'
import { Layout } from './layout'
import { CursorPagination, FormMessage, ProfileHeader, ProfileTabs } from './page-shared'
import { Post } from './post'
import { linkify } from '../utils'

export function Profile(
  { user, profile, posts, following, bio = profile.bio || '', editHandle = profile.handle, editEmail = profile.email,
    error, editing = false, total = posts.length, followerCount = 0, followingCount = 0, followingTagCount = 0,
    blockedPeopleCount = 0, blockedTagCount = 0, blocked = false, blockedByProfile = false, social,
    previousCursor = null, nextCursor = null }: {
      user: User | null
      profile: ProfileRow
      posts: PostView[]
      following: boolean
      bio?: string
      editHandle?: string
      editEmail?: string
      error?: string
      editing?: boolean
      total?: number
      followerCount?: number
      followingCount?: number
      followingTagCount?: number
      blockedPeopleCount?: number
      blockedTagCount?: number
      blocked?: boolean
      blockedByProfile?: boolean
      previousCursor?: string | null
      nextCursor?: string | null
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  return (
    <Layout user={user} title={`@${profile.handle}`} social={social} feeds={{
      title: `Notes by @${profile.handle}`,
      rss: `/u/${encodeURIComponent(profile.handle)}.rss`,
      atom: `/u/${encodeURIComponent(profile.handle)}.atom`,
    }}>
      <ProfileHeader user={user} profile={profile} following={following} blocked={blocked} editing={editing}>
        <div className="profile-content">
          <div className="profile-title-row">
            <h1>
              <span className="identity-prefix">@</span>
              {profile.handle}
            </h1>
            {user?.id === profile.id && (
              editing
                ? <a className="profile-edit-link" href={'/u/' + profile.handle}>back</a>
                : (
                  <div className="profile-owner-actions">
                    <a className="profile-edit-link" href="/account/edit">account</a>
                    <form method="post" action="/logout">
                      <button className="profile-edit-link profile-logout">logout</button>
                    </form>
                  </div>
                )
            )}
          </div>
          {user?.id === profile.id && editing
            ? (
              <>
                <form className="bio-form" method="post" action="/account/edit">
                  <FormMessage error={error} />
                  <label>
                    handle<input name="handle" required pattern="[A-Za-z0-9_]{2,24}" defaultValue={editHandle} />
                  </label>
                  <label>
                    bio<textarea name="bio" maxLength={160} defaultValue={bio}
                      placeholder="Tell people a little about yourself…" />
                  </label>
                  <div className="composefoot">
                    <span>160 characters max</span>
                    <button className="button">save profile →</button>
                  </div>
                </form>
                <div className="account-danger-zone">
                  <div>
                    <strong>Account security</strong>
                    <span>Manage your email and signed-in sessions.</span>
                  </div>
                  <a className="button" href="/account/security">manage security</a>
                </div>
                <div className="account-danger-zone">
                  <div>
                    <strong>Download your data</strong>
                    <span>Export your account, notes, connections, and activity as a JSON file.</span>
                  </div>
                  <a className="button" href="/account/export" download>download data</a>
                </div>
                <div className="account-danger-zone">
                  <div>
                    <strong>Delete account</strong>
                    <span>Permanently remove your profile and turn your notes into deleted tombstones.</span>
                  </div>
                  <a className="button delete-button" href="/account/delete">delete account</a>
                </div>
              </>
            )
            : <p className="profile-bio"
              dangerouslySetInnerHTML={{ __html: linkify(profile.bio || 'No bio yet.') }} />}
        </div>
      </ProfileHeader>
      {blocked || blockedByProfile
        ? (
          <div className="empty relationship-notice">
            {blocked ? 'You blocked this user. Unblock them to see their notes.' : 'This profile is unavailable.'}
          </div>
        )
        : !editing && (
          <ProfileTabs profile={profile} active="notes" notes={total} followers={followerCount}
            following={followingCount} followingTags={followingTagCount} showBlocked={user?.id === profile.id}
            blockedPeople={blockedPeopleCount} blockedTags={blockedTagCount} />
        )}
      {!editing && !blocked && !blockedByProfile && posts.map(post => <Post key={post.id} p={post} user={user} />)}
      {!editing && !blocked && !blockedByProfile && total === 0 && (
        <div className="empty">
          {user?.id === profile.id
            ? 'You haven’t posted any notes yet.'
            : `@${profile.handle} hasn’t posted any notes yet.`}
        </div>
      )}
      {!editing && !blocked && !blockedByProfile
        && <CursorPagination path={'/u/' + profile.handle} previousCursor={previousCursor} nextCursor={nextCursor} />}
    </Layout>
  )
}
