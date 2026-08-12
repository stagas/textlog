import React from 'react'
import { isAdmin } from '../admin'
import { containsAsciiArt } from '../content'
import { db, type User } from '../db'
import { enrichPosts } from '../posts'
import type { PostView } from '../types'
import { fmt, fmtFull, linkify } from '../utils'

function renderFlags(post: PostView | NonNullable<PostView['parent']>) {
  return post.has_latex == null || post.has_links == null || post.has_code == null
    ? undefined
    : { has_latex: post.has_latex, has_links: post.has_links, has_code: post.has_code }
}

export const MAX_VISIBLE_REPLY_DEPTH = 5

export function PreviewPost({ p }: { p: PostView }) {
  return (
    <article className="post" id={`post-${p.id}`}>
      <div className="posttop preview-post-meta">
        <span className="postauthor" title={p.bio || 'No bio yet.'}>@{p.handle}</span>
        <span className="postdate">
          <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
        </span>
        <span className="quiet preview-reply">reply</span>
      </div>
      <p className={containsAsciiArt(p.body) ? 'ascii-art' : undefined} dangerouslySetInnerHTML={{
        __html: linkify(p.body, p.mention_bios, [], undefined, renderFlags(p)),
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
}: { p: PostView; user: User | null; showReplyAction?: boolean; showOwnerActions?: boolean;
  showModerateAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string;
  reportHref?: string; foldControlId?: string; highlightTerms?: string[]; tappable?: boolean; tappableParent?: boolean;
  contextLabel?: string; contextUnread?: boolean; preview?: boolean; returnPath?: string; backHref?: string })
{
  const parent = showParent ? p.parent : null
  const hasTappableParent = Boolean(parent && (tappable || tappableParent))
  const isAsciiArt = containsAsciiArt(p.body)
  const replyCount = p.reply_count || 0
  const returnQuery = returnPath ? '&from=' + encodeURIComponent(returnPath) : ''
  const actionQuery = returnPath ? '?from=' + encodeURIComponent(returnPath) : ''
  const detailPath = '/post/' + p.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
  const parentDetailPath = parent
    ? '/post/' + parent.id + (returnPath ? '?from=' + encodeURIComponent(returnPath) : '')
    : ''
  const parentReplyPath = parent ? '/post/' + parent.id + '?reply=1' + returnQuery : ''
  const defaultReplyPath = '/post/' + p.id + '?reply=1' + returnQuery
  const resolvedReplyHref = replyHref
    ?? (user ? defaultReplyPath : '/enter?next=' + encodeURIComponent(defaultReplyPath))
  const resolvedReplyLabel = replyLabel ?? (user ? 'reply' : 'enter to reply')
  if (p.deleted_at) {
    return (
      <article className="post deleted-post" id={`post-${p.id}`}>
        <a href={detailPath}>
          (deleted){showReplyCount && replyCount > 0
            ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
            : ''}
        </a>
      </article>
    )
  }
  return (
    <article className={`post${tappable || hasTappableParent ? ' tappable-post' : ''}`} id={`post-${p.id}`}>
      {tappable && <a className="post-hit-area" href={detailPath} aria-label={`open post by @${p.handle}`} />}
      <div className={`posttop${contextLabel ? ' posttop-context' : ''}`}>
        {contextUnread && <span className="unread-dot" aria-label="unread" />}
        {preview
          ? <span className="postauthor" title={p.bio || 'No bio yet.'}>@{p.handle}</span>
          : <a className="postauthor" href={'/u/' + p.handle} title={p.bio || 'No bio yet.'}>@{p.handle}</a>}
        {contextLabel && <span className="post-context">{contextLabel}</span>}
        {preview
          ? (
            <span className="postdate">
              <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
            </span>
          )
          : (
            <a className="postdate" href={detailPath}>
              <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>
              {showReplyCount && replyCount > 0 && (
                <span>{' '}· {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
              )}
            </a>
          )}
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
        __html: linkify(p.body, p.mention_bios, highlightTerms, undefined, renderFlags(p)),
      }} />
      {parent && (
        <blockquote className={'parent-quote' + (parent.deleted_at ? ' deleted-parent' : '')
          + (hasTappableParent ? ' tappable-parent' : '')}
        >
          {hasTappableParent && (
            <a className="parent-hit-area" href={parentDetailPath}
              aria-label={`open quoted post by @${parent.handle}`} />
          )}
          {parent.deleted_at
            ? <a href={parentDetailPath}>(deleted)</a>
            : (
              <>
                <div className="parent-quote-top">
                  <a className="postauthor" href={'/u/' + parent.handle + actionQuery}
                    title={parent.bio || 'No bio yet.'}>
                    @{parent.handle}
                  </a>
                  <a className="postdate" href={parentDetailPath}>
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
                  __html: linkify(parent.body, parent.mention_bios, [], undefined, renderFlags(parent)),
                }} />
              </>
            )}
        </blockquote>
      )}
    </article>
  )
}

export function ThreadReplies({ parentId, user, returnPath, excludePostId }: { parentId: number; user: User | null;
  returnPath?: string; excludePostId?: number }) {
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
                returnPath={returnPath}
                replyHref={user ? undefined : '/enter?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1'
                  + (returnPath ? '&from=' + encodeURIComponent(returnPath) : ''))}
                replyLabel={user ? 'reply' : 'enter to reply'} tappable />
              {childBranch}
              {continuesElsewhere && (
                <div className="thread-continuation">
                  <a className="quiet" href={'/post/' + reply.id}>
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
