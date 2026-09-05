import type React from 'preact/compat'

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
