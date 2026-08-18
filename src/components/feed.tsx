import type { PersonalizedFeedData, PersonalizedTimelineRow, User } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'
import { MetaRow, MetaStats } from './meta'
import { ActionPair, FeedTabs, Pagination } from './page-shared'
import { Post, TagReference, UserReference } from './post'

export type ForYouCursor = { createdAt: string; key: string; direction: 'next' | 'previous' }

export function decodeForYouCursor(value?: string): ForYouCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== 1
      || typeof decoded[1] !== 'string' || !decoded[1] || typeof decoded[2] !== 'string' || !decoded[2]
      || !['next', 'previous'].includes(decoded[3])) return null
    return { createdAt: decoded[1], key: decoded[2], direction: decoded[3] }
  }
  catch { return null }
}

export function encodeForYouCursor(cursor: ForYouCursor) {
  return Buffer.from(JSON.stringify([1, cursor.createdAt, cursor.key, cursor.direction])).toString('base64url')
}

type TimelineGroup = { rows: PersonalizedTimelineRow[]; collapsible: boolean }

export function groupSimilarActivities(timeline: PersonalizedTimelineRow[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  const similarityKey = (row: PersonalizedTimelineRow) => ['post', 'reply', 'mention'].includes(row.activity_kind)
    ? null : `${row.activity_kind}:${row.target_is_viewer}`
  for (const row of timeline) {
    const key = similarityKey(row)
    const previous = groups.at(-1)
    if (key && previous && similarityKey(previous.rows[0]) === key) previous.rows.push(row)
    else groups.push({ rows: [row], collapsible: key !== null })
  }
  return groups
}

export function Feed({ user, data, title, path = '/for-you', pageUrl, notificationBanner = false, toMe = false }: {
  user: User
  data: PersonalizedFeedData
  title?: string
  path?: string
  pageUrl?: string
  notificationBanner?: false | 'notifications' | 'appearance' | 'invite' | 'notification-update' | 'donate'
  toMe?: boolean
}) {
  const returnPath = path + (data.page > 1 ? `?page=${data.page}` : '')
  const hasUnread = toMe ? data.toMeUnread : data.forYouUnread || data.toMeUnread
  const renderTimelineRow = (row: PersonalizedTimelineRow) => {
    const activityAnchor = `activity-${row.event_key.replace(/[^a-z0-9_-]+/gi, '-')}`
    const activityReturnPath = `${returnPath}#${activityAnchor}`
    const fromQuery = `?from=${encodeURIComponent(activityReturnPath)}`
    return ['post', 'reply', 'mention'].includes(row.activity_kind)
      ? (
        <div className={`for-you-item${row.unread && row.targeted_to_viewer ? ' activity-item-directed-unread' : ''}`}
          key={row.event_key}>
          <Post p={row.renderedPost!} user={user} showReplyCount tappable contextUnread={!!row.unread}
            returnPath={`${returnPath}#post-${row.id}`} contextLabel={row.activity_kind === 'reply'
            ? 'replied to you:' : row.activity_kind === 'mention' ? 'mentioned you:' : undefined} />
        </div>
      )
      : (
        <article className={`activity-follow${row.unread && row.targeted_to_viewer
          ? ' activity-item-directed-unread' : ''}`} key={row.event_key} id={activityAnchor}>
          <div className="activity-follow-content">
            <MetaRow className="activity-follow-main" unread={!!row.unread}>
              <UserReference handle={row.actor_handle} bio={row.actor_bio}
                noteCount={row.actorProfileStats?.notes || 0} stats={row.actorProfileStats}
                following={!!row.following} user={user} href={row.activity_kind === 'signup'
                  ? `/admin/users/${row.actor_id}` : `/u/${row.actor_handle}${fromQuery}`}
                navigationQuery={fromQuery} />
              <span className="activity-context">
                {row.activity_kind === 'signup' ? 'signed up:' : row.target_is_viewer ? 'followed you:' : 'followed'}
              </span>
              {!row.target_is_viewer && row.activity_kind === 'user_follow'
                ? <UserReference handle={row.target_handle!} bio={row.target_bio || ''} noteCount={row.posts || 0}
                  stats={row.targetProfileStats} following={!!row.following} user={user}
                  href={`/u/${row.target_handle}${fromQuery}`} navigationQuery={fromQuery} />
                : row.activity_kind === 'tag_follow'
                ? <TagReference tag={row.target_tag!} noteCount={row.posts || 0}
                  followerCount={row.tagFollowerCount || 0} following={!!row.following} user={user}
                  href={`/tag/${encodeURIComponent(row.target_tag!)}${fromQuery}`} navigationQuery={fromQuery} />
                : null}
              {row.posts !== null
                ? <MetaStats createdAt={row.created_at} count={row.posts} href={(row.activity_kind === 'tag_follow'
                    ? `/tag/${row.target_tag}` : `/u/${row.activity_kind === 'user_follow' && !row.target_is_viewer
                      ? row.target_handle : row.actor_handle}`) + fromQuery} />
                : <MetaStats createdAt={row.created_at} count={null} className="activity-follow-stats" />}
            </MetaRow>
            {(row.activity_kind === 'user_follow' || row.activity_kind === 'signup') && (
              <p className="profile-bio" dangerouslySetInnerHTML={{ __html: linkify(displayBio(row.target_bio)) }} />
            )}
          </div>
          {row.actor_id !== user.id && (
            <form method="post" action={row.target_is_viewer || row.activity_kind === 'signup'
              ? `/follow/${row.actor_handle}` : row.activity_kind === 'user_follow'
              ? `/follow/${row.target_handle}` : `/tag-follow/${row.target_tag}`}>
              <input type="hidden" name="from" value={activityReturnPath} />
              <button className={`button${row.following ? ' button-muted' : ''}`}>
                {row.following ? 'unfollow' : 'follow'}
                {row.activity_kind === 'user_follow' && !row.target_is_viewer && ` @${row.target_handle}`}
                {row.activity_kind === 'tag_follow' && ` #${row.target_tag}`}
              </button>
            </form>
          )}
        </article>
      )
  }
  return (
    <Layout user={user} title={title} pageUrl={pageUrl} notificationBanner={notificationBanner}>
      <h1 className="visually-hidden">Your feed</h1>
      <FeedTabs active="following" user={user} forYouReadStatus={data.timeline.length ? hasUnread : undefined}
        toMe={toMe} toMeCount={toMe ? 0 : data.toMeCount} forYouCount={data.forYouCount} unreadHref={data.unreadHref}
        forYouUnread={data.forYouUnread} toMeUnread={data.toMeUnread} />
      {data.page > 1 && <Pagination page={data.page} totalPages={data.totalPages} path={path} top />}
      {data.timeline.length
        ? groupSimilarActivities(data.timeline).map(group => group.rows.length > 1 && group.collapsible
          ? <div className="activity-group" key={group.rows[0].event_key}>
            {renderTimelineRow(group.rows[0])}
            <details className="activity-more"><summary>and {group.rows.length - 1} more</summary>
              {group.rows.slice(1).map(renderTimelineRow)}</details>
          </div>
          : renderTimelineRow(group.rows[0]))
        : data.page === 1
        ? <div className="empty empty-actions">
          <p>{toMe ? 'No replies, mentions, or new followers yet.'
            : 'Your timeline is empty. Follow people or hashtags to shape it.'}</p>
          <ActionPair primary={<a className="button" href="/explore">explore tags &amp; people</a>}
            secondary={<><a href="/">browse notes</a><span className="action-separator">or</span>
              <a href="/write">write your first note</a></>} />
        </div>
        : <div className="empty">No activity on this page. <a href="/for-you">Return to the first page</a>.</div>}
      <Pagination page={data.page} totalPages={data.totalPages} path={path} />
    </Layout>
  )
}
