import React from 'react'
import { db, type User } from '../db'
import { fmt, fmtFull, linkify } from '../utils'

export function Post({ p, user, showReplyAction = true, showParent = true, showReplyCount = false, replyHref, replyLabel = 'reply' }: { p: any; user: User | null; showReplyAction?: boolean; showParent?: boolean; showReplyCount?: boolean; replyHref?: string; replyLabel?: string }) {
  const parent = showParent && p.parent_id
    ? db.query(`SELECT p.id,p.body,p.created_at,p.deleted_at,u.handle,
        (SELECT count(*) FROM posts replies WHERE replies.parent_id=p.id) reply_count
        FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(p.parent_id) as any
    : null
  const replyCount = showReplyCount
    ? (db.query('SELECT count(*) AS count FROM posts WHERE parent_id=?').get(p.id) as { count: number }).count
    : 0
  if (p.deleted_at) return <article className="post deleted-post">
    <a href={'/post/' + p.id}>(deleted){showReplyCount && replyCount > 0
      ? ` · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
      : ''}</a>
  </article>
  return <article className="post">
    <div className="posttop">
      <a className="postauthor" href={'/u/' + p.handle}>@{p.handle}</a>
      <a className="postdate" href={'/post/' + p.id}>
        <time dateTime={p.created_at} title={fmtFull(p.created_at)}>{fmt(p.created_at)}</time>{showReplyCount && replyCount > 0 && <span> · {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>}
      </a>
      {showReplyAction && <a className="quiet" href={replyHref || '/post/' + p.id + '?reply=1'}>{replyLabel}</a>}
      {user?.id === p.user_id && <div className="post-actions">
        <a className="quiet" href={'/post/' + p.id + '/edit'}>edit</a>
        <a className="quiet danger" href={'/post/' + p.id + '/delete'}>delete</a>
      </div>}
    </div>
    <p dangerouslySetInnerHTML={{ __html: linkify(p.body) }} />
    {parent && <blockquote className={'parent-quote' + (parent.deleted_at ? ' deleted-parent' : '')}>
      {parent.deleted_at
        ? <a href={'/post/' + parent.id}>(deleted)</a>
        : <>
          <div className="parent-quote-top">
            <a className="postauthor" href={'/u/' + parent.handle}>@{parent.handle}</a>
            <a className="postdate" href={'/post/' + parent.id}>
              <time dateTime={parent.created_at} title={fmtFull(parent.created_at)}>{fmt(parent.created_at)}</time>
              {parent.reply_count > 0 && <span> · {parent.reply_count} {parent.reply_count === 1 ? 'reply' : 'replies'}</span>}
            </a>
          </div>
          <p dangerouslySetInnerHTML={{ __html: linkify(parent.body) }} />
        </>}
    </blockquote>}
  </article>
}

export function ThreadReplies({ parentId, user }: { parentId: number; user: User | null }) {
  const replies = db.query(
    'SELECT p.*,u.handle FROM posts p JOIN users u ON u.id=p.user_id WHERE p.parent_id=? ORDER BY p.created_at ASC',
  ).all(parentId) as any[]
  if (!replies.length) return null
  return <div className="reply-branch" style={{ '--depth': 1 } as React.CSSProperties}>
    {replies.map(reply => reply.deleted_at
      ? <ThreadReplies key={reply.id} parentId={reply.id} user={user} />
      : <div className="reply-node" key={reply.id}>
        <Post p={reply} user={user} showParent={false}
          replyHref={user ? undefined : '/login?next=' + encodeURIComponent('/post/' + reply.id + '?reply=1')}
          replyLabel={user ? 'reply' : 'log in to reply'} />
        <ThreadReplies parentId={reply.id} user={user} />
      </div>)}
  </div>
}
