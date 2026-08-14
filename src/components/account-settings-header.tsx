import type { ReactNode } from 'react'

export function PageHeading(
  { eyebrow, title, action, className }: {
    eyebrow: string
    title: string
    action?: ReactNode
    className?: string
  },
) {
  return (
    <div className={`account-settings-heading${className ? ` ${className}` : ''}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  )
}

export function AccountSettingsHeader({ title, returnPath }: { title: string; returnPath?: string }) {
  const backHref = returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'
  return (
    <PageHeading
      eyebrow="account settings"
      title={title}
      action={<a className="profile-edit-link" href={backHref}>back</a>}
    />
  )
}
