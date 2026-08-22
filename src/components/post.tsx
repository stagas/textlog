import React from 'react'
import { isAdmin } from '../admin'
import { containsAsciiArt, extractHashtags, extractMentions } from '../content'
import type { User } from '../types'
import type { BioReferenceData, PostView, UserProfileStats } from '../types'
import { displayBio, displayPostBody, linkify, referenceFormId } from '../utils'
import { enterHref } from './auth-links'
import { MetaRow } from './meta'
import { parsePoll, pollDisplayBody } from '../polls'

function Poll({ p, returnPath }: { p: PostView | NonNullable<PostView['parent']>; returnPath?: string }) {
  if (!p.poll) return null
  const showResults = p.poll.expired || p.poll.viewerVoted
  return (
    <div className={`poll${showResults ? ' poll-results' : ''}`} aria-label="Poll">
      {p.poll.options.map(option => {
        const percent = p.poll!.totalVotes ? Math.round(option.votes / p.poll!.totalVotes * 100) : 0
        return showResults
          ? (
            <div className={`poll-result${option.selected ? ' poll-selected' : ''}`} key={option.id}>
              <span className="poll-result-fill" style={{ width: `${percent}%` }} />
              <span className="poll-option-label">{option.label}</span>
              <span className="poll-option-count">{percent}%</span>
            </div>
          )
          : (
            <form method="post" action={`/post/${p.id}/poll`} className="poll-option" key={option.id}>
              <input type="hidden" name="option" value={option.id} />
              <input type="hidden" name="from" value={returnPath || `/post/${p.id}`} />
              <button type="submit">{option.label}</button>
            </form>
          )
      })}
      {p.poll.expired && <span className="poll-meta">{p.poll.totalVotes} voted</span>}
    </div>
  )
}

function renderedPollBody(body: string) {
  return pollDisplayBody(body)
}

function isDeletedHandle(handle: string) {
  return /^deleted-\d+$/.test(handle)
}

function PollPreview({ body }: { body: string }) {
  const poll = parsePoll(body)
  if (!poll) return null
  return (
    <div className="poll poll-preview" aria-label="Poll preview">
      {poll.options.map(option => (
        <div className="poll-option poll-preview-option" key={option}>
          {option}
        </div>
      ))}
    </div>
  )
}

export function UserReference(
  { handle, bio, noteCount, following, followsViewer, user, href, rel, currentHandle, stats, navigationQuery = '',
    showFollowAction = true, showPopover = true, label, referenceData, extraAction }: {
      handle: string
      bio?: string
      noteCount: number
      following?: boolean
      followsViewer?: boolean
      user: User | null
      href?: string
      rel?: string
      currentHandle?: string
      stats?: UserProfileStats
      navigationQuery?: string
      showFollowAction?: boolean
      showPopover?: boolean
      label?: React.ReactNode
      referenceData?: BioReferenceData
      extraAction?: React.ReactNode
    },
) {
  const ownUser = (user?.handle || currentHandle)?.toLowerCase() === handle.toLowerCase()
  const followReturnPath = new URLSearchParams(navigationQuery.slice(1)).get('from') || undefined
  const bioTags = extractHashtags(bio || '')
  const bioTagCounts = referenceData?.hashtagCounts || {}
  const bioTagFollowerCounts = referenceData?.hashtagFollowerCounts || {}
  const bioMentionBios = referenceData?.mentionBios || {}
  const bioMentionProfileStats = referenceData?.mentionProfileStats || {}
  const bioMentionNoteCounts = referenceData?.mentionNoteCounts || {}
  const bioFormPrefix = `handle-${handle.toLowerCase()}-bio`
  return (
    <span className="reference-menu">
      {href
        ? <a className="reference-menu-trigger postauthor" href={href} rel={rel}>{label || <>@{handle}</>}</a>
        : <span className="reference-menu-trigger postauthor" tabIndex={0}>{label || <>@{handle}</>}</span>}
      {showPopover && <span className="reference-menu-popover">
        <span className="reference-popover-bio" dangerouslySetInnerHTML={{
          __html: linkify(displayBio(bio), bioMentionBios, [], undefined, undefined, navigationQuery, bioTagCounts,
            bioMentionNoteCounts, {
            signedIn: !!user,
            currentHandle: user?.handle,
            formPrefix: bioFormPrefix,
            mentionFollowing: referenceData?.mentionFollowing,
            mentionFollowsViewer: referenceData?.mentionFollowsViewer,
            mentionProfileStats: bioMentionProfileStats,
            hashtagFollowing: referenceData?.hashtagFollowing,
            hashtagFollowerCounts: bioTagFollowerCounts,
            linkPreviews: referenceData?.linkPreviews,
          }),
        }} />
        {showFollowAction && !ownUser && (user
          ? (
            <span className="reference-popover-actions">
              <form method="post" action={'/follow/' + handle}>
                {followReturnPath && <input type="hidden" name="from" value={followReturnPath} />}
                {!!followsViewer && <span className="follows-you">follows you</span>}
                <button className={`button${following ? ' button-muted' : ''}`} type="submit">
                  {following ? 'unfollow' : followsViewer ? 'follow back' : 'follow'}
                </button>
              </form>
              <form method="post" action={'/block/' + handle}>
                <button className="quiet danger" type="submit">block</button>
              </form>
              {extraAction}
            </span>
          )
          : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>)}
      </span>}
      {showPopover && user && bioTags.map(tag => (
        <React.Fragment key={tag}>
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'tag', tag)} method="post"
            action={'/tag-follow/' + encodeURIComponent(tag)} />
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'tag', tag, 'block')} method="post"
            action={'/tag-block/' + encodeURIComponent(tag)} />
        </React.Fragment>
      ))}
      {showPopover && user && Object.keys(bioMentionBios).map(bioHandle => (
        <React.Fragment key={`user-${bioHandle}`}>
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'user', bioHandle)} method="post"
            action={'/follow/' + encodeURIComponent(bioHandle)} />
          <form className="reference-follow-form" id={referenceFormId(bioFormPrefix, 'user', bioHandle, 'block')}
            method="post" action={'/block/' + encodeURIComponent(bioHandle)} />
        </React.Fragment>
      ))}
    </span>
  )
}

export function TagReference(
  { tag, noteCount, followerCount, following, user, href, navigationQuery = '', showFollowAction = true,
    showPopover = true, label }: {
    tag: string
    noteCount: number
    followerCount: number
    following?: boolean
    user: User | null
    href?: string
    navigationQuery?: string
    showFollowAction?: boolean
    showPopover?: boolean
    label?: React.ReactNode
  },
) {
  const tagPath = `/tag/${encodeURIComponent(tag)}`
  const followReturnPath = new URLSearchParams(navigationQuery.slice(1)).get('from') || undefined
  return (
    <span className="reference-menu">
      <a className="reference-menu-trigger" href={href || tagPath + navigationQuery}>{label || <>#{tag}</>}</a>
      {showPopover && showFollowAction && <span className="reference-menu-popover reference-menu-popover-tag">
        {user
          ? (
            <span className="reference-popover-actions">
              <form method="post" action={`/tag-follow/${encodeURIComponent(tag)}`}>
                {followReturnPath && <input type="hidden" name="from" value={followReturnPath} />}
                <button className={`button${following ? ' button-muted' : ''}`} type="submit">
                  {following ? 'unfollow' : 'follow'}
                </button>
              </form>
              <form method="post" action={`/tag-block/${encodeURIComponent(tag)}`}>
                <button className="quiet danger" type="submit">block</button>
              </form>
            </span>
          )
          : <a className="button" href={enterHref()} rel="nofollow">enter to follow</a>}
      </span>}
    </span>
  )
}

export function BioReferenceForms({ data, prefix, user }: {
  data?: BioReferenceData
  prefix: string
  user: User | null
}) {
  if (!user || !data) return null
  return <>
    {Object.keys(data.hashtagFollowing).map(tag => <React.Fragment key={`tag-${tag}`}>
      <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag)} method="post"
        action={`/tag-follow/${encodeURIComponent(tag)}`} />
      <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag, 'block')} method="post"
        action={`/tag-block/${encodeURIComponent(tag)}`} />
    </React.Fragment>)}
    {Object.keys(data.mentionBios).map(handle => <React.Fragment key={`user-${handle}`}>
      <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle)} method="post"
        action={`/follow/${encodeURIComponent(handle)}`} />
      <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle, 'block')} method="post"
        action={`/block/${encodeURIComponent(handle)}`} />
    </React.Fragment>)}
  </>
}

function ReferenceFollowForms(
  { post, prefix, user, returnPath }: { post: PostView | NonNullable<PostView['parent']>; prefix: string;
    user: User | null; returnPath: string },
) {
  if (!user) return null
  const handles = extractMentions(post.body).filter(handle => handle !== user.handle.toLowerCase())
  const tags = extractHashtags(post.body)
  return (
    <>
      {handles.map(handle => (
        <React.Fragment key={'user-' + handle}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle)} method="post"
            action={'/follow/' + handle}
          >
            <input type="hidden" name="from" value={returnPath} />
          </form>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'user', handle, 'block')} method="post"
            action={'/block/' + handle} />
        </React.Fragment>
      ))}
      {tags.map(tag => (
        <React.Fragment key={'tag-' + tag}>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag)} method="post"
            action={'/tag-follow/' + encodeURIComponent(tag)}
          >
            <input type="hidden" name="from" value={returnPath} />
          </form>
          <form className="reference-follow-form" id={referenceFormId(prefix, 'tag', tag, 'block')} method="post"
            action={'/tag-block/' + encodeURIComponent(tag)} />
        </React.Fragment>
      ))}
    </>
  )
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
      <MetaRow className="posttop preview-post-meta">
        <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats} user={null}
          currentHandle={p.handle} referenceData={p.bio_reference} />
        <span className="postdate">read</span>
      </MetaRow>
      <div className={`post-body${containsAsciiArt(p.body) ? ' ascii-art' : ''}`} dangerouslySetInnerHTML={{
        __html: linkify(displayPostBody(renderedPollBody(p.body)), p.mention_bios, [], undefined, renderFlags(p), '', p.hashtag_counts,
          p.mention_note_counts, { signedIn: false, currentHandle: p.handle, formPrefix,
          hashtagFollowerCounts: p.hashtag_follower_counts, linkPreviews: p.link_previews }),
      }} />
      <PollPreview body={p.body} />
      <MetaRow className="postfoot preview-post-meta">
        <span className="quiet preview-reply">reply</span>
      </MetaRow>
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
  contextDirectedUnread = false,
  preview = false,
  returnPath,
  backHref,
  canonicalTimestamp = false,
  topHref,
  flatHref,
  treeHref,
  authorPopoverAction,
  continuationHref,
  continuationLabel = 'read more',
}: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean;
  showModerateAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string;
  reportHref?: string; foldControlId?: string; highlightTerms?: string[]; tappable?: boolean; tappableParent?: boolean;
  contextLabel?: React.ReactNode; contextUnread?: boolean; contextDirectedUnread?: boolean; preview?: boolean;
  returnPath?: string; backHref?: string;
  canonicalTimestamp?: boolean; topHref?: string; flatHref?: string; treeHref?: string;
  authorPopoverAction?: React.ReactNode; continuationHref?: string; continuationLabel?: string })
{
  const parent = showParent ? p.parent : null
  const parentContinued = parent?.parent_id && parent.parent?.user_id === parent.user_id
  const parentContextTarget = parent?.parent_id && !parent.poll && !parentContinued
    && parent.parent?.user_id !== user?.id ? parent.parent : null
  const parentContextLabel = parent?.poll
    ? `created a poll${parent.viewer_mentioned ? ' and mentioned you' : ''}:`
    : parentContinued
    ? `continued${parent?.viewer_mentioned ? ' and mentioned you' : ''}:`
    : parent?.parent_id
    ? parent.parent?.user_id === user?.id
      ? `replied to you${parent.viewer_mentioned ? ' and mentioned you' : ''}:`
      : parentContextTarget
      ? 'replied to'
      : undefined
    : `wrote${parent?.viewer_mentioned ? ' and mentioned you' : ''}:`
  const hasTappableParent = Boolean(parent && (tappable || tappableParent))
  const isAsciiArt = containsAsciiArt(p.body)
  const returnQuery = returnPath ? '&from=' + encodeURIComponent(returnPath) : ''
  const actionQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  const referenceQuery = preview
    ? actionQuery
    : '?from=' + encodeURIComponent(returnPath || `/post/${p.id}#post-${p.id}`)
  const continued = p.parent_id && p.parent?.user_id === p.user_id
  const canModerate = showModerateAction && isAdmin(user)
  const contextTarget = !p.poll && contextLabel == null && p.parent_id && !continued && p.viewer_context !== 'reply'
    ? p.parent
    : null
  contextLabel = p.poll
    ? `created a poll${p.viewer_mentioned ? ' and mentioned you' : ''}:`
    : contextLabel ?? (p.parent_id
      ? continued
        ? `continued${p.viewer_mentioned ? ' and mentioned you' : ''}:`
        : p.viewer_context === 'reply'
        ? `replied to you${p.viewer_mentioned ? ' and mentioned you' : ''}:`
        : contextTarget
        ? 'replied to'
        : undefined
      : `wrote${p.viewer_mentioned ? ' and mentioned you' : ''}:`)
  if (p.viewer_mentioned && !contextTarget && typeof contextLabel === 'string'
    && !contextLabel.includes('mentioned you')) {
    contextLabel = contextLabel.replace(/:$/, '') + ' and mentioned you:'
  }
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
  const resolvedReplyLabel = replyLabel ?? (user
    ? user.id === p.user_id ? 'continue' : 'reply'
    : 'enter to reply')
  if (p.deleted_at) {
    return (
      <article className="post deleted-post" id={`post-${p.id}`}>
        <a href={detailPath} rel={navigationRel}>
          (deleted post)
        </a>
      </article>
    )
  }
  return (
    <article className={`post${tappable || hasTappableParent ? ' tappable-post' : ''}${
      contextDirectedUnread ? ' activity-item-directed-unread' : ''}`} id={`post-${p.id}`}>
      {tappable && (
        <a className="post-hit-area" href={detailPath} rel={navigationRel} aria-label={`open post by @${p.handle}`} />
      )}
      <MetaRow className={`posttop${contextLabel ? ' posttop-context' : ''}${preview ? ' preview-post-meta' : ''}`}
        unread={contextUnread}
      >
        {user?.id === p.user_id
          ? <span className="postauthor post-context-author">you</span>
          : preview
          ? (
            <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
              following={p.viewer_following} followsViewer={p.follows_viewer} user={user}
              referenceData={p.bio_reference} extraAction={authorPopoverAction} />
          )
          : (
            <UserReference handle={p.handle} bio={p.bio} noteCount={p.note_count || 0} stats={p.profile_stats}
              following={p.viewer_following} followsViewer={p.follows_viewer} user={user}
              href={'/u/' + p.handle + referenceQuery} rel={navigationRel} navigationQuery={referenceQuery}
              referenceData={p.bio_reference} extraAction={authorPopoverAction} />
          )}
        {contextLabel && (canonicalTimestamp
          ? (
            <>
              <a className="post-context" href={`/post/${p.id}`}>
                {typeof contextLabel === 'string' ? contextLabel.replace(/:$/, '') : contextLabel}
              </a>
              {!contextTarget && <span className="post-context post-context-punctuation">:</span>}
            </>
          )
          : <span className="post-context">{contextLabel}</span>)}
        {contextTarget && (
          <>
            {isDeletedHandle(contextTarget.handle)
              ? <span className="post-context deleted-context">(deleted account)</span>
              : <UserReference handle={contextTarget.handle} bio={contextTarget.bio}
                noteCount={contextTarget.note_count || 0} stats={contextTarget.profile_stats}
                following={contextTarget.viewer_following} followsViewer={contextTarget.follows_viewer} user={user}
                href={`/u/${contextTarget.handle}${referenceQuery}`} rel={navigationRel}
                navigationQuery={referenceQuery} referenceData={contextTarget.bio_reference} />}
            <span className={`post-context post-context-punctuation${
              p.viewer_mentioned ? ' post-context-mention-suffix' : ''}`}>
              {p.viewer_mentioned ? ' and mentioned you:' : ':'}
            </span>
          </>
        )}
        {preview
          ? <span className="postdate">read</span>
          : !tappable && !canonicalTimestamp && (
            <a className="postdate" href={canonicalTimestamp ? `/post/${p.id}` : detailPath}
              rel={canonicalTimestamp ? undefined : navigationRel}
            >
              {canonicalTimestamp ? 'permalink' : 'read'}
            </a>
          )}
        {foldControlId && (
          <label className="quiet thread-fold" htmlFor={foldControlId} title="fold or unfold replies">
            <span className="visually-hidden">fold or unfold replies</span>
          </label>
        )}
        {tappable && parent && (
          <a className="quiet post-top-link"
            href={replyAnchorReturnPath(parent.top_id || parent.id, parent.top_id || parent.id, returnPath)}>top</a>
        )}
        {(flatHref || treeHref || showOwnerActions && user?.id === p.user_id || topHref || backHref) && (
          <div className="post-navigation-actions">
            {showOwnerActions && user?.id === p.user_id && (
              <div className="post-actions">
                <a className="quiet" href={'/post/' + p.id + '/edit' + actionQuery}
                  aria-label="edit this post">edit</a>
              </div>
            )}
            {flatHref && <a className="quiet post-top-link" href={flatHref}>flat</a>}
            {treeHref && <a className="quiet post-top-link" href={treeHref}>tree</a>}
            {topHref && <a className="quiet post-top-link" href={topHref}>top</a>}
            {backHref && <a className="quiet post-back-link" href={backHref}>back</a>}
          </div>
        )}
      </MetaRow>
      <div className={`post-body${isAsciiArt ? ' ascii-art' : ''}`} dangerouslySetInnerHTML={{
        __html: linkify(displayPostBody(renderedPollBody(p.body)), p.mention_bios, highlightTerms, undefined, renderFlags(p),
          referenceQuery, p.hashtag_counts, p.mention_note_counts, { signedIn: !!user, currentHandle: user?.handle,
          formPrefix, mentionFollowing: p.mention_following, mentionFollowsViewer: p.mention_follows_viewer,
          mentionProfileStats: p.mention_profile_stats, hashtagFollowing: p.hashtag_following,
          hashtagFollowerCounts: p.hashtag_follower_counts, linkPreviews: p.link_previews }),
      }} />
      {preview ? <PollPreview body={p.body} /> : <Poll p={p} returnPath={returnPath} />}
      {!parent && (showReplyAction || continuationHref || canModerate || reportHref) && (
      <MetaRow className={`postfoot${preview ? ' preview-post-meta' : ''}`}>
        {!parent && showReplyAction && (preview
          ? <span className="quiet preview-reply">{resolvedReplyLabel}</span>
          : <a className="quiet post-reply-link" href={resolvedReplyHref} rel="nofollow"
            aria-label={`${resolvedReplyLabel} to @${p.handle}`}>{resolvedReplyLabel}</a>)}
        {continuationHref && <a className="quiet post-continuation-link" href={continuationHref} rel="nofollow">
          {continuationLabel}
        </a>}
        {(canModerate || reportHref) && (
          <span className="post-actions">
            {canModerate && (
              <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
                moderate
              </a>
            )}
            {reportHref && (
              <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
            )}
          </span>
        )}
      </MetaRow>
      )}
      <ReferenceFollowForms post={p} prefix={formPrefix} user={user}
        returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
      {parent && (
        <blockquote className={'parent-quote' + (containsAsciiArt(parent.body) ? ' ascii-art' : '')
          + (parent.deleted_at ? ' deleted-parent' : '')
          + (hasTappableParent ? ' tappable-parent' : '')}
        >
          {hasTappableParent && (
            <a className="parent-hit-area" href={parentDetailPath} rel={navigationRel}
              aria-label={`open quoted post by @${parent.handle}`} />
          )}
          {parent.deleted_at
            ? <a href={parentDetailPath} rel={navigationRel}>(deleted post)</a>
            : (
              <>
                <div className="parent-quote-top">
                  {user?.id === parent.user_id
                    ? <span className="postauthor post-context-author">you</span>
                    : <UserReference handle={parent.handle} bio={parent.bio} noteCount={parent.note_count || 0}
                      stats={parent.profile_stats} following={parent.viewer_following}
                      followsViewer={parent.follows_viewer} user={user} href={'/u/' + parent.handle + referenceQuery}
                      rel={navigationRel} navigationQuery={referenceQuery} referenceData={parent.bio_reference} />}
                  {parentContextLabel && <span className="post-context">{parentContextLabel}</span>}
                  {parentContextTarget && (
                    <>
                      {isDeletedHandle(parentContextTarget.handle)
                        ? <span className="post-context deleted-context">(deleted account)</span>
                        : <UserReference handle={parentContextTarget.handle} bio={parentContextTarget.bio}
                          noteCount={parentContextTarget.note_count || 0} stats={parentContextTarget.profile_stats}
                          following={parentContextTarget.viewer_following}
                          followsViewer={parentContextTarget.follows_viewer} user={user}
                          href={`/u/${parentContextTarget.handle}${referenceQuery}`} rel={navigationRel}
                          navigationQuery={referenceQuery} referenceData={parentContextTarget.bio_reference} />}
                      <span className="post-context post-context-punctuation">
                        {parent.viewer_mentioned ? ' and mentioned you:' : ':'}
                      </span>
                    </>
                  )}
                  {!hasTappableParent && (
                    <a className="postdate" href={parentDetailPath} rel={navigationRel}>read</a>
                  )}
                </div>
                <div className={`post-body${containsAsciiArt(parent.body) ? ' ascii-art' : ''}`} dangerouslySetInnerHTML={{
                  __html: linkify(displayPostBody(renderedPollBody(parent.body)), parent.mention_bios, [], undefined, renderFlags(parent),
                    referenceQuery, parent.hashtag_counts, parent.mention_note_counts, { signedIn: !!user,
                    currentHandle: user?.handle, formPrefix: `${formPrefix}-parent-${parent.id}`,
                    mentionFollowing: parent.mention_following, mentionFollowsViewer: parent.mention_follows_viewer,
                    mentionProfileStats: parent.mention_profile_stats, hashtagFollowing: parent.hashtag_following,
                    hashtagFollowerCounts: parent.hashtag_follower_counts, linkPreviews: parent.link_previews }),
                }} />
                <Poll p={parent} returnPath={returnPath} />
                <div className="parent-quote-foot">
                  <a className="quiet" href={user
                    ? parentReplyPath
                    : '/enter?next=' + encodeURIComponent(parentReplyPath)} rel="nofollow"
                    aria-label={`${user && user.id === parent.user_id ? 'continue' : 'reply to'} @${parent.handle}`}
                  >
                    {user ? user.id === parent.user_id ? 'continue' : 'reply' : 'enter to reply'}
                  </a>
                </div>
                <ReferenceFollowForms post={parent} prefix={`${formPrefix}-parent-${parent.id}`} user={user}
                  returnPath={returnPath || `/post/${p.id}#post-${p.id}`} />
              </>
            )}
        </blockquote>
      )}
      {parent && (showReplyAction || continuationHref || canModerate || reportHref) && (
        <MetaRow className={`postfoot postfoot-after-quote${preview ? ' preview-post-meta' : ''}`}>
          {showReplyAction && (preview
            ? <span className="quiet preview-reply">{resolvedReplyLabel}</span>
            : <a className="quiet post-reply-link" href={resolvedReplyHref} rel="nofollow"
              aria-label={`${resolvedReplyLabel} to @${p.handle}`}>{resolvedReplyLabel}</a>)}
          {continuationHref && <a className="quiet post-continuation-link" href={continuationHref} rel="nofollow">
            {continuationLabel}
          </a>}
          {(canModerate || reportHref) && (
            <span className="post-actions">
              {canModerate && (
                <a className="quiet danger" href={'/admin/posts/' + p.id + '/delete'} aria-label="moderate this post">
                  moderate
                </a>
              )}
              {reportHref && (
                <a className="quiet report-link" href={reportHref} aria-label={`report post by @${p.handle}`}>report</a>
              )}
            </span>
          )}
        </MetaRow>
      )}
    </article>
  )
}

export function ThreadReplies(
  { parentId, replies, user, returnPath, excludePostId, flat = false, showMissingContinuations = false,
    continuationLabel = 'read more', continuationReturnPath, contextUnreadPostIds,
    contextDirectedUnreadPostIds }: { parentId: number; replies: PostView[];
    user: User | null; returnPath?: string; excludePostId?: number; flat?: boolean;
    showMissingContinuations?: boolean; continuationLabel?: string; continuationReturnPath?: string;
    contextUnreadPostIds?: ReadonlySet<number>; contextDirectedUnreadPostIds?: ReadonlySet<number> },
) {
  if (!replies.length) return null
  const children = new Map<number, PostView[]>()
  for (const reply of replies) {
    const siblings = children.get(reply.parent_id!) || []
    siblings.push(reply)
    children.set(reply.parent_id!, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
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
  const renderReply = (reply: PostView, childBranch?: React.ReactNode, continuesElsewhere = false) => {
    const anchoredReturnPath = replyAnchorReturnPath(parentId, reply.id, returnPath)
    const foldControlId = childBranch ? `thread-fold-${reply.id}` : undefined
    const continuationHref = continuesElsewhere
      ? '/post/' + reply.id + '?from=' + encodeURIComponent(
          continuationReturnPath ? `${continuationReturnPath}#post-${reply.id}` : anchoredReturnPath,
        )
      : undefined
    return (
      <div className="reply-node" key={reply.id}>
        {foldControlId && <input className="thread-fold-input" type="checkbox" id={foldControlId} />}
        <Post p={reply} user={user} showParent={false} foldControlId={foldControlId}
          returnPath={anchoredReturnPath} contextUnread={contextUnreadPostIds?.has(reply.id)}
          contextDirectedUnread={contextDirectedUnreadPostIds?.has(reply.id)}
          replyHref={user ? undefined : '/enter?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1'
            + '&from=' + encodeURIComponent(anchoredReturnPath))} replyLabel={user ? undefined : 'enter to reply'}
          continuationHref={continuationHref} continuationLabel={continuationLabel} tappable />
        {childBranch}
      </div>
    )
  }
  if (flat) {
    const flattened: PostView[] = []
    const visit = (id: number) => {
      for (const reply of children.get(id) || []) {
        if (!reply.deleted_at && reply.id !== excludePostId) flattened.push(reply)
        visit(reply.id)
      }
    }
    visit(parentId)
    return flattened.length
      ? <div className="reply-branch reply-branch-flat">{flattened.map(reply => renderReply(reply))}</div>
      : null
  }
  const renderBranch = (id: number, depth: number): React.ReactNode => {
    const branch = children.get(id) || []
    if (!branch.length) return null
    return (
      <div className="reply-branch">
        {branch.map(reply => {
          const descendantCount = visibleDescendantCount(reply.id)
          const truncatedByDepth = !reply.deleted_at && depth >= MAX_VISIBLE_REPLY_DEPTH && descendantCount > 0
          const hasMissingDescendants = !reply.deleted_at && showMissingContinuations
            && descendantCount === 0 && (reply.reply_count || 0) > 0
          const continuesElsewhere = truncatedByDepth || hasMissingDescendants
          const childBranch = truncatedByDepth ? null : renderBranch(reply.id, depth + 1)
          if (reply.deleted_at) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
          if (reply.id === excludePostId) return <React.Fragment key={reply.id}>{childBranch}</React.Fragment>
          return renderReply(reply, childBranch, continuesElsewhere)
        })}
      </div>
    )
  }
  return renderBranch(parentId, 1)
}

/** Render only the posts supplied by a feed, joining replies to parents that are on the same page. */
export function FeedThreads(
  { posts, user, returnPath, contextUnreadPostIds, contextDirectedUnreadPostIds }: { posts: PostView[];
    user: User | null; returnPath: string; contextUnreadPostIds?: ReadonlySet<number>;
    contextDirectedUnreadPostIds?: ReadonlySet<number> },
) {
  if (!posts.length) return null
  const sourceIds = new Set(posts.map(post => post.id))
  const missingParentReferences = new Map<number, PostView[]>()
  for (const post of posts) {
    if (!post.parent_id || sourceIds.has(post.parent_id) || !post.parent) continue
    missingParentReferences.set(post.parent_id, [...(missingParentReferences.get(post.parent_id) || []), post])
  }
  const sharedParents: PostView[] = []
  for (const references of missingParentReferences.values()) {
    if (references.length < 2) continue
    const parent = references[0].parent!
    sharedParents.push({
      ...parent,
      user_id: parent.user_id ?? -1,
      parent_id: parent.parent_id ?? null,
      reply_count: parent.reply_count || 0,
    })
  }
  const treePosts = [...posts, ...sharedParents]
  const ids = new Set(treePosts.map(post => post.id))
  const positions = new Map(treePosts.map((post, index) => [post.id, index]))
  const children = new Map<number, PostView[]>()
  for (const post of treePosts) {
    if (!post.parent_id || !ids.has(post.parent_id)) continue
    children.set(post.parent_id, [...(children.get(post.parent_id) || []), post])
  }
  const conversationPosition = (root: PostView) => {
    let position = positions.get(root.id)!
    const visit = (parentId: number) => {
      for (const child of children.get(parentId) || []) {
        position = Math.min(position, positions.get(child.id)!)
        visit(child.id)
      }
    }
    visit(root.id)
    return position
  }
  const visibleReplyCount = (root: PostView) => {
    let count = 0
    const visit = (parentId: number) => {
      for (const child of children.get(parentId) || []) {
        if (!child.deleted_at) count++
        visit(child.id)
      }
    }
    visit(root.id)
    return count
  }
  const roots = treePosts.filter(post => !post.parent_id || !ids.has(post.parent_id))
    .sort((a, b) => conversationPosition(a) - conversationPosition(b))
  return (
    <>
      {roots.map(post => {
        const anchoredReturnPath = `${returnPath}#post-${post.id}`
        const visibleReplies = visibleReplyCount(post)
        const continuesElsewhere = visibleReplies > 0 && (post.reply_count || 0) > visibleReplies
        const foldControlId = visibleReplies > 0 ? `feed-thread-fold-${post.id}` : undefined
        return (
          <div className="post-page-thread feed-thread" key={post.id}>
            {foldControlId && <input className="thread-fold-input" type="checkbox" id={foldControlId} />}
            <div className="thread-root">
              <Post p={post} user={user} showReplyCount tappable returnPath={anchoredReturnPath}
                contextUnread={contextUnreadPostIds?.has(post.id)} foldControlId={foldControlId}
                contextDirectedUnread={contextDirectedUnreadPostIds?.has(post.id)}
                continuationHref={continuesElsewhere
                  ? `/post/${post.id}?from=${encodeURIComponent(anchoredReturnPath)}`
                  : undefined} />
            </div>
            <ThreadReplies parentId={post.id} replies={treePosts} user={user} returnPath={anchoredReturnPath}
              showMissingContinuations continuationLabel="read more" continuationReturnPath={returnPath}
              contextUnreadPostIds={contextUnreadPostIds}
              contextDirectedUnreadPostIds={contextDirectedUnreadPostIds} />
          </div>
        )
      })}
    </>
  )
}
