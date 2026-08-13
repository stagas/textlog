import { db, type User } from '../db'
import { extractHashtags } from '../content'
import { visibleHashtagCounts, visibleTagFollowerCounts } from '../posts'
import type { PostView, ProfileRow } from '../types'
import { displayBio, linkify, referenceFormId } from '../utils'
import { Layout } from './layout'
import { FormMessage, Pagination, PostingHelp, PostingSuggestionResults, type PostingSuggestionSearch,
  ProfileControls, ProfileHeader, ProfileTabs } from './page-shared'
import { Post } from './post'

export function Profile(
  { user, profile, posts, following, bio = profile.bio || '', editHandle = profile.handle, editEmail = profile.email,
    error, editing = false, total = posts.length, noteCount = total, replyCount = 0, tab = 'notes', followerCount = 0,
    followingCount = 0, followingTagCount = 0, blockedPeopleCount = 0, blockedTagCount = 0, blocked = false,
    blockedByProfile = false, social, page = 1, totalPages = 1, returnPath, suggestionSearch }: {
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
      noteCount?: number
      replyCount?: number
      tab?: 'notes' | 'replies'
      followerCount?: number
      followingCount?: number
      followingTagCount?: number
      blockedPeopleCount?: number
      blockedTagCount?: number
      blocked?: boolean
      blockedByProfile?: boolean
      page?: number
      totalPages?: number
      returnPath?: string
      suggestionSearch?: PostingSuggestionSearch | null
      social?: { description: string; image: string; url: string; type?: 'article' | 'profile'; imageAlt?: string }
    },
) {
  const feedQuery = new URLSearchParams()
  if (tab === 'replies') feedQuery.set('tab', 'replies')
  if (page > 1) feedQuery.set('page', String(page))
  const feedPath = `/u/${profile.handle}${feedQuery.size ? `?${feedQuery}` : ''}`
  const paginationQuery = new URLSearchParams()
  if (tab === 'replies') paginationQuery.set('tab', 'replies')
  if (returnPath) paginationQuery.set('from', returnPath)
  const paginationPath = `/u/${profile.handle}${paginationQuery.size ? `?${paginationQuery}` : ''}`
  const fromQuery = returnPath ? `?from=${encodeURIComponent(returnPath)}` : ''
  const bioTags = extractHashtags(profile.bio)
  const bioTagCounts = visibleHashtagCounts(db, [profile.bio], user?.id ?? -1)
  const bioTagFollowerCounts = visibleTagFollowerCounts(db, bioTags, user?.id ?? -1)
  const followedBioTags = user && bioTags.length
    ? new Set((db.query(`SELECT tag FROM hashtag_follows WHERE user_id=? AND tag IN
      (${bioTags.map(() => '?').join(',')})`).all(user.id, ...bioTags) as { tag: string }[])
      .map(row => row.tag))
    : new Set<string>()
  const bioTagFollowing = Object.fromEntries(bioTags.map(tag => [tag, followedBioTags.has(tag)]))
  const bioFormPrefix = `profile-${profile.id}-bio`
  return (
    <Layout user={user} title={`@${profile.handle}`} social={social} feeds={{
      title: `Notes by @${profile.handle}`,
      rss: `/u/${encodeURIComponent(profile.handle)}.rss`,
      atom: `/u/${encodeURIComponent(profile.handle)}.atom`,
    }}>
      <ProfileHeader user={user} profile={profile} following={following} blocked={blocked} editing={editing}
        returnPath={returnPath} controlsInTitle>
        <div className="profile-content">
          <div className={`profile-title-row${!editing && user?.id !== profile.id
            ? ' profile-title-row-actions'
            : ''}`}>
            <h1>
              <a className="profile-canonical-link" href={`/u/${profile.handle}`}>
                <span className="identity-prefix">@</span>
                {profile.handle}
              </a>
            </h1>
            {editing && <a className="profile-edit-link profile-switch-link" href="/account/accounts">switch</a>}
            {!editing && user?.id !== profile.id
              && <ProfileControls user={user} profile={profile} following={following} blocked={blocked} />}
            {(editing || user?.id === profile.id) && (
              <div className="profile-owner-actions">
                {editing
                  ? <a className="profile-edit-link" href={returnPath || '/u/' + profile.handle}>back</a>
                  : (
                    <>
                      {user?.id === profile.id && (
                        <>
                          <a className="profile-edit-link" href="/account/edit">account</a>
                          <form method="post" action="/logout">
                            <button className="profile-edit-link profile-logout">logout</button>
                          </form>
                        </>
                      )}
                      {returnPath && user?.id === profile.id
                        && <a className="profile-edit-link profile-owner-back-link" href={returnPath}>back</a>}
                    </>
                  )}
              </div>
            )}
          </div>
          {user?.id === profile.id && editing
            ? (
              <>
                <form className="bio-form" method="post" action="/account/edit">
                  {returnPath && <input type="hidden" name="from" value={returnPath} />}
                  <FormMessage error={error} />
                  <label>
                    handle<input name="handle" aria-describedby="profile-handle-help" defaultValue={editHandle}
                      autoComplete="username" inputMode="text" enterKeyHint="next" autoCapitalize="none"
                      spellCheck={false} />
                    <span id="profile-handle-help" className="form-hint">
                      Handles must be 2–24 characters and use only letters, numbers, or underscores.
                    </span>
                  </label>
                  <label>
                    bio<textarea name="bio" maxLength={160} defaultValue={bio}
                      placeholder="Tell people a little about yourself…" autoComplete="off" inputMode="text"
                      enterKeyHint="enter" />
                  </label>
                  <PostingSuggestionResults search={suggestionSearch} />
                  <div className="composefoot">
                    <PostingHelp maxLength={160} maxLines={5} search={suggestionSearch} />
                    <button className="button">save profile →</button>
                  </div>
                </form>
                <div className="account-danger-zone">
                  <div>
                    <strong>Appearance</strong>
                    <span>Choose a theme, accent color, and monospace font for textlog.</span>
                  </div>
                  <a className="button" href={`/account/edit/appearance${fromQuery}`}>change appearance</a>
                </div>
                <div className="account-danger-zone">
                  <div>
                    <strong>Account security</strong>
                    <span>Manage your email and signed-in sessions.</span>
                  </div>
                  <a className="button" href={`/account/security${fromQuery}`}>manage security</a>
                </div>
                <div className="account-danger-zone">
                  <div>
                    <strong>Notifications</strong>
                    <span>Choose browser notifications for new notes, replies, mentions, and follows.</span>
                  </div>
                  <a className="button" href={`/account/edit/notifications${fromQuery}`}>manage notifications</a>
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
                  <a className="button button-danger" href="/account/delete">delete account</a>
                </div>
              </>
            )
            : <p className="profile-bio" dangerouslySetInnerHTML={{ __html: linkify(displayBio(profile.bio),
              {}, [], undefined, undefined, '', bioTagCounts, {}, { signedIn: !!user, currentHandle: user?.handle,
                formPrefix: bioFormPrefix, hashtagFollowing: bioTagFollowing,
                hashtagFollowerCounts: bioTagFollowerCounts }) }} />}
          {!editing && user && bioTags.map(tag => <form className="reference-follow-form"
            id={referenceFormId(bioFormPrefix, 'tag', tag)} method="post"
            action={'/tag-follow/' + encodeURIComponent(tag)} key={tag} />)}
        </div>
      </ProfileHeader>
      {blocked || blockedByProfile
        ? (
          <div className="empty relationship-notice">
            {blocked ? 'You blocked this user. Unblock them to see their notes.' : 'This profile is unavailable.'}
          </div>
        )
        : !editing && (
          <ProfileTabs profile={profile} active={tab} notes={noteCount} replies={replyCount} followers={followerCount}
            following={followingCount} followingTags={followingTagCount} showBlocked={user?.id === profile.id}
            blockedPeople={blockedPeopleCount} blockedTags={blockedTagCount} returnPath={returnPath} />
        )}
      {!editing && !blocked && !blockedByProfile && page > 1
        && (
          <Pagination path={paginationPath} page={page}
            totalPages={totalPages} top />
        )}
      {!editing && !blocked && !blockedByProfile
        && posts.map(post => (
          <Post key={post.id} p={post} user={user} showReplyCount tappable returnPath={`${feedPath}#post-${post.id}`} />
        ))}
      {!editing && !blocked && !blockedByProfile && total === 0 && (
        <div className={`empty${user?.id === profile.id ? ' empty-actions' : ''}`}>
          {user?.id === profile.id
            ? (
              <>
                <p>{tab === 'replies' ? 'You haven’t posted any replies yet.' : 'You haven’t posted any notes yet.'}</p>
                {tab === 'notes' && <a className="button" href="/write">write a note</a>}
              </>
            )
            : tab === 'replies'
            ? `@${profile.handle} hasn’t posted any replies yet.`
            : `@${profile.handle} hasn’t posted any notes yet.`}
        </div>
      )}
      {!editing && !blocked && !blockedByProfile
        && (
          <Pagination path={paginationPath} page={page}
            totalPages={totalPages} />
        )}
    </Layout>
  )
}
