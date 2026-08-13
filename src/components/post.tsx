import React from 'react'
import { isAdmin } from '../admin'
import { containsAsciiArt, extractHashtags, extractMentions } from '../content'
import { db, type User } from '../db'
import { enrichPosts } from '../posts'
import type { PostView, UserProfileStats } from '../types'
import { fmt, fmtFull, linkify, referenceFormId } from '../utils'

export function UserReference({ handle, bio, noteCount, following, user, href, rel, currentHandle, stats,
  navigationQuery = '' }: {
  handle: string; bio?: string; noteCount: number; following?: boolean; user: User | null; href?: string; rel?: string;
  currentHandle?: string; stats?: UserProfileStats; navigationQuery?: string }) {
  const ownUser = (user?.handle || currentHandle)?.toLowerCase() === handle.toLowerCase()
  const followReturnPath = new URLSearchParams(navigationQuery.slice(1)).get('from') || undefined
  const profileHref = (tab?: string) => tab
    ? `/u/${handle}?tab=${tab}${navigationQuery ? `&${navigationQuery.slice(1)}` : ''}`
    : `/u/${handle}${navigationQuery}`
  return (
    <span className="reference-menu">
      {href
        ? <a className="reference-menu-trigger postauthor" href={href} rel={rel}>@{handle}</a>
        : <span className="reference-menu-trigger postauthor" tabIndex={0}>@{handle}</span>}
      <span className="reference-menu-popover">
        {stats
          ? <span className="reference-profile-tabs">
              <a href={profileHref()}>{stats.notes.toLocaleString()} {stats.notes === 1 ? 'note' : 'notes'}</a>
              <a href={profileHref('replies')}>{stats.replies.toLocaleString()}{' '}
                {stats.replies === 1 ? 'reply' : 'replies'}</a>
              <a href={profileHref('following')}>{stats.followingTags.toLocaleString()}{' '}
                {stats.followingTags === 1 ? 'tag' : 'tags'}, {stats.following.toLocaleString()}{' '}
                {stats.following === 1 ? 'user' : 'users'} following</a>
              <a href={profileHref('followers')}>{stats.followers.toLocaleString()}{' '}
                {stats.followers === 1 ? 'follower' : 'followers'}</a>
            </span>
          : <span>{noteCount.toLocaleString()} {noteCount === 1 ? 'note' : 'notes'}</span>}
        <span className="reference-popover-bio" dangerouslySetInnerHTML={{
          __html: linkify(bio || 'No bio yet.', {}, [], undefined, undefined, navigationQuery),
        }} />
        {!ownUser && (user
          ? <form method="post" action={'/follow/' + handle}>
              {followReturnPath && <input type="hidden" name="from" value={followReturnPath} />}
              <button className={`button${following ? ' button-muted' : ''}`} type="submit">
                {following ? 'unfollow' : 'follow'}
              </button>
            </form>
          : <a className="button" href="/enter" rel="nofollow">enter to follow</a>)}
      </span>
    </span>
  )
}

function ReferenceFollowForms({ post, prefix, user, returnPath }: { post: PostView | NonNullable<PostView['parent']>;
  prefix: string; user: User | null; returnPath: string }) {
  if (!user) return null
  const handles = extractMentions(post.body).filter(handle => handle !== user.handle.toLowerCase())
  const tags = extractHashtags(post.body)
  return <>
    {handles.map(handle => <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle)}
      method="post" action={'/follow/' + handle} key={'user-' + handle}>
        <input type="hidden" name="from" value={returnPath} />
      </form>)}
    {tags.map(tag => <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag)}
      method="post" action={'/tag-follow/' + encodeURIComponent(tag)} key={'tag-' + tag}>
        <input type="hidden" name="from" value={returnPath} />
      </form>)}
  </>
}

function renderFlags(post: PostView | NonNullable<PostView['parent']>) {
  return post.has_latex == null || post.has_links == null || post.has_code == null
    ? undefined
    : { has_latex: post.has_latex, has_links: post.has_links, has_code: post.has_code }
}

export const MAX_VISIBLE_REPLY_DEPTH = 5

export function replyAnchorReturnPath(threadRootId: number, replyId: number, returnPath?: string) {
  const returnQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  return `/post/${threadRootId}${returnQuery}#post-${replyId}`
}

export function postedReplyPath(parentId: number, replyId: number, returnPath?: string) {
  if (returnPath) {
    const target = new URL(returnPath, 'http://textlog.local')
    if (/^\/post\/[1-9]\d*$/.test(target.pathname)) {
      return `${target.pathname}${target.search}#post-${replyId}`
    }
  }
  return replyAnchorReturnPath(parentId, replyId, returnPath)
}

export function conversationTopPath(threadRootId: number, replyId: number, returnPath?: string) {
  const deepPostPath = `/post/${replyId}${returnPath ? '?from=' + encodeURIComponent(returnPath) : ''}#post-${replyId}`
  return `/post/${threadRootId}?from=${encodeURIComponent(deepPostPath)}#post-${threadRootId}`
}

export function PreviewPost({ p }: { p: PostView }) {
  const formPrefix = `preview-post-${p.id}`
  return (
    <article className="post" id={`post-${p.id}`}>
      <div className="posttop preview-post-meta">
        <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats} user={null}
          currentHandle={p.handle} />
        <span className="postdate">
          <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
        </span>
        <span className="quiet preview-reply">reply</span>
      </div>
      <p className={containsAsciiArt(p.body) ? 'ascii-art' : undefined} dangerouslySetInnerHTML={{
        __html: linkify(p.body, p.mention_bios, [], undefined, renderFlags(p), '', p.hashtag_counts,
          p.mention_note_counts, { signedIn: false, currentHandle: p.handle, formPrefix,
            hashtagFollowerCounts: p.hashtag_follower_counts }),
      }} />
    </article>
  )
}

export function Post({
  p,
  user,
  showReplyAction = true,
  showOwnerActions = false,
  showModerateAction = false,
  showParent = true,
  showReplyCount = false,
  replyHref,
  replyLabel,
  reportHref,
  foldControlId,
  highlightTerms = [],
  tappable = false,
  tappableParent = false,
  contextLabel,
  contextUnread = false,
  preview = false,
  returnPath,
  backHref,
  canonicalTimestamp = false,
  topHref,
}: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean;
  showModerateAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string;
  reportHref?: string; foldControlId?: string; highlightTerms?: string[]; tappable?: boolean; tappableParent?: boolean;
  contextLabel?: string; contextUnread?: boolean; preview?: boolean; returnPath?: string; backHref?: string;
  canonicalTimestamp?: boolean; topHref?: string })
{
  const parent = showParent ? p.parent : null
  const hasTappableParent = Boolean(parent && (tappable || tappableParent))
  const isAsciiArt = containsAsciiArt(p.body)
  const replyCount = p.reply_count || 0
  const returnQuery = returnPath ? '&from=' + encodeURIComponent(returnPath) : ''
  const actionQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  const referenceQuery = preview ? actionQuery
    : '?from=' + encodeURIComponent(returnPath || `/post/${p.id}#post-${p.id}`)
  const detailPath = '/post/' + p.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
  const parentDetailPath = parent
    ? '/post/' + parent.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
    : ''
  const parentReplyPath = parent ? '/post/' + parent.id + '?reply=1' + returnQuery : ''
  const defaultReplyPath = '/post/' + p.id + '?reply=1' + returnQuery
  const navigationRel = returnPath ? 'nofollow' : undefined
  const formPrefix = `post-${p.id}`
  const resolvedReplyHref = replyHref
    ?? (user ? defaultReplyPath : '/enter?next=' + encodeURIComponent(defaultReplyPath))
  const resolvedReplyLabel = replyLabel ?? (user ? 'reply' : 'enter to reply')
  if (p.deleted_at) {
    return (
      <article className="post deleted-post" id={`post-${p.id}`}>
        <a href={detailPath} rel={navigationRel}>
          (deleted){showReplyCount && replyCount > 0
            ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
            : ''}
        </a>
      </article>
    )
  }
  return (
    <article className={`post${tappable || hasTappableParent ? ' tappable-post' : ''}`} id={`post-${p.id}`}>
      {tappable && <a className="post-hit-area" href={detailPath} rel={navigationRel}
        aria-label={`open post by @${p.handle}`} />}
      <div className={`posttop${contextLabel ? ' posttop-context' : ''}${preview ? ' preview-post-meta' : ''}`}>
        {contextUnread && <span className="unread-dot" aria-label="unread" />}
        {preview
          ? <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
              following={p.viewer_following} user={user} />
          : <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
              following={p.viewer_following} user={user} href={'/u/' + p.handle + referenceQuery} rel={navigationRel}
              navigationQuery={referenceQuery} />}
        {contextLabel && <span className="post-context">{contextLabel}</span>}
        {preview
          ? (
            <span className="postdate">
              <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
            </span>
          )
          : (
            <a className="postdate" href={canonicalTimestamp ? `/post/${p.id}` : detailPath}
              rel={canonicalTimestamp ? undefined : navigationRel}>
              <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
              {showReplyCount && replyCount > 0 && (
                <span>{' '}· {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
              )}
            </a>
          )}
        {topHref && <a className="quiet post-top-link" href={topHref}>top</a>}
        {showReplyAction && (
          preview
            ? <span className="quiet preview-reply">{resolvedReplyLabel}</span>
            : (
              <a className="quiet post-reply-link" href={resolvedReplyHref} rel="nofollow"
                aria-label={`${resolvedReplyLabel} to @${p.handle}`}
              >
                {resolvedReplyLabel}
              </a>
            )
        )}
        {reportHref && (
          <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
        )}
        {showOwnerActions && user?.id === p.user_id && (
          <div className="post-actions">
            <a className="quiet" href={'/post/' + p.id + '/edit' + actionQuery} aria-label="edit this post">edit</a>
          </div>
        )}
        {showModerateAction && isAdmin(user) && (
          <div className="post-actions admin-post-actions">
            <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
              moderate
            </a>
          </div>
        )}
        {backHref && <a className="quiet post-back-link" href={backHref}>back</a>}
        {foldControlId && (
          <label className="quiet thread-fold" htmlFor={foldControlId} title="fold or unfold replies">
            <span className="visually-hidden">fold or unfold replies</span>
          </label>
        )}
      </div>
      <p className={isAsciiArt ? 'ascii-art' : undefined} dangerouslySetInnerHTML={{
        __html: linkify(p.body, p.mention_bios, highlightTerms, undefined, renderFlags(p), referenceQuery,
          p.hashtag_counts, p.mention_note_counts, { signedIn: !!user, currentHandle: user?.handle, formPrefix,
            mentionFollowing: p.mention_following, mentionProfileStats: p.mention_profile_stats,
            hashtagFollowing: p.hashtag_following, hashtagFollowerCounts: p.hashtag_follower_counts }),
      }} />
      <ReferenceFollowForms post={p} prefix={formPrefix} user={user}
        returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
      {parent && (
        <blockquote className={'parent-quote' + (parent.deleted_at ? ' deleted-parent' : '')
          + (hasTappableParent ? ' tappable-parent' : '')}
        >
          {hasTappableParent && (
            <a className="parent-hit-area" href={parentDetailPath} rel={navigationRel}
              aria-label={`open quoted post by @${parent.handle}`} />
          )}
          {parent.deleted_at
            ? <a href={parentDetailPath} rel={navigationRel}>(deleted)</a>
            : (
              <>
                <div className="parent-quote-top">
                  <UserReference handle={parent.handle} bio={parent.bio} noteCount={parent.note_count || 0}
                    stats={parent.profile_stats} following={parent.viewer_following} user={user}
                    href={'/u/' + parent.handle + referenceQuery}
                    rel={navigationRel} navigationQuery={referenceQuery} />
                  <a className="postdate" href={parentDetailPath} rel={navigationRel}>
                    <time dateTime={parent.created_at} title={fmtFull(parent.created_at)}>
                      {fmt(parent.created_at)}
                    </time>
                    {parent.reply_count > 0 && (
                      <span>{' '}· {parent.reply_count} {parent.reply_count === 1 ? 'reply' : 'replies'}</span>
                    )}
                  </a>
                  <a className="quiet" href={user
                    ? parentReplyPath
                    : '/enter?next=' + encodeURIComponent(parentReplyPath)} rel="nofollow"
                    aria-label={`reply to @${parent.handle}`}
                  >
                    {user ? 'reply' : 'enter to reply'}
                  </a>
                </div>
                <p className={containsAsciiArt(parent.body) ? 'ascii-art' : undefined} dangerouslySetInnerHTML={{
                  __html: linkify(parent.body, parent.mention_bios, [], undefined, renderFlags(parent), referenceQuery,
                    parent.hashtag_counts, parent.mention_note_counts, { signedIn: !!user,
                      currentHandle: user?.handle, formPrefix: `${formPrefix}-parent-${parent.id}`,
                      mentionFollowing: parent.mention_following, mentionProfileStats: parent.mention_profile_stats,
                      hashtagFollowing: parent.hashtag_following,
                      hashtagFollowerCounts: parent.hashtag_follower_counts }),
                }} />
                <ReferenceFollowForms post={parent} prefix={`${formPrefix}-parent-${parent.id}`} user={user}
                  returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
              </>
            )}
        </blockquote>
      )}
    </article>
  )
}

export function ThreadReplies(
  { parentId, user, returnPath, excludePostId }: { parentId: number; user: User | null; returnPath?: string;
    excludePostId?: number },
) {
  const viewerId = user?.id ?? -1
  const rows = db.query(`WITH RECURSIVE thread AS (
      SELECT p.*,u.handle,1 depth FROM posts p JOIN users u ON u.id=p.user_id WHERE p.parent_id=? AND (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
      UNION ALL
      SELECT p.*,u.handle,thread.depth+1 FROM posts p JOIN users u ON u.id=p.user_id
        JOIN thread ON p.parent_id=thread.id WHERE (? < 0 OR NOT EXISTS
        (SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)))
        AND (? < 0 OR NOT EXISTS (SELECT 1 FROM post_hashtags ph JOIN blocked_hashtags bh ON bh.tag=ph.tag
          WHERE ph.post_id=p.id AND bh.user_id=?))
    ) SELECT id,user_id,parent_id,body,created_at,deleted_at,has_latex,has_links,has_code,handle,depth
      FROM thread ORDER BY created_at ASC,id ASC`).all(parentId, viewerId, viewerId, viewerId, viewerId, viewerId,
    viewerId, viewerId, viewerId, viewerId, viewerId) as (PostView & { depth: number })[]
  const replies = enrichPosts(db, rows, viewerId)
  if (!replies.length) return null
  const children = new Map<number, PostView[]>()
  for (const reply of replies) {
    const siblings = children.get(reply.parent_id!) || []
    siblings.push(reply)
    children.set(reply.parent_id!, siblings)
  }
  const descendantCounts = new Map<number, number>()
  const visibleDescendantCount = (id: number): number => {
    const cached = descendantCounts.get(id)
    if (cached !== undefined) return cached
    const count = (children.get(id) || [])
      .reduce((total, reply) => total + (reply.deleted_at ? 0 : 1) + visibleDescendantCount(reply.id), 0)
    descendantCounts.set(id, count)
    return count
  }
  const renderBranch = (id: number, depth: number): React.ReactNode => {
    const branch = children.get(id) || []
    if (!branch.length) return null
    return (
      <div className="reply-branch">
        {branch.map(reply => {
          const anchoredReturnPath = replyAnchorReturnPath(parentId, reply.id, returnPath)
          const descendantCount = visibleDescendantCount(reply.id)
          const continuesElsewhere = !reply.deleted_at && depth >= MAX_VISIBLE_REPLY_DEPTH && descendantCount > 0
          const childBranch = continuesElsewhere ? null : renderBranch(reply.id, depth + 1)
          if (reply.deleted_at) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
          if (reply.id === excludePostId) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
          const foldControlId = childBranch ? `thread-fold-${reply.id}` : undefined
          return (
            <div className="reply-node" key={reply.id}>
              {foldControlId && <input className="thread-fold-input" type="checkbox" id={foldControlId} />}
              <Post p={reply} user={user} showParent={false} foldControlId={foldControlId}
                returnPath={anchoredReturnPath}
                replyHref={user ? undefined : '/enter?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1'
                  + '&from=' + encodeURIComponent(anchoredReturnPath))} replyLabel={user ? 'reply' : 'enter to reply'}
                tappable />
              {childBranch}
              {continuesElsewhere && (
                <div className="thread-continuation">
                  <a className="quiet" rel="nofollow"
                    href={'/post/' + reply.id + '?from=' + encodeURIComponent(anchoredReturnPath)}>
                    more ({descendantCount} {descendantCount === 1 ? 'reply' : 'replies'})
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  return renderBranch(parentId, 1)
}
