import type React from 'react'
import { fmt, fmtFull } from '../utils'

export function MetaRow({ className, unread = false, children }: {
  className?: string
  unread?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      {unread && <span className="unread-dot" aria-label="unread" />}
      {children}
    </div>
  )
}

export function MetaStats({ createdAt, count, singular = 'note', href, smallCount = false,
  className = 'activity-follow-stats' }: {
  createdAt: string
  count?: number | null
  singular?: string
  href?: string
  smallCount?: boolean
  className?: string
}) {
  const content = (
    <>
      <time dateTime={createdAt} title={fmtFull(createdAt)}>{fmt(createdAt)}</time>
      {count != null && (
        <>
          <span aria-hidden="true">·</span>
          {smallCount
            ? <small>{count} {count === 1 ? singular : `${singular}s`}</small>
            : <span>{count} {count === 1 ? singular : `${singular}s`}</span>}
        </>
      )}
    </>
  )
  return href
    ? <a className={className} href={href}>{content}</a>
    : <span className={className}>{content}</span>
}
