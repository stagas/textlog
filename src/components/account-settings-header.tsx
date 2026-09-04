import type { ReactNode } from 'react'

export function PageHeading(
  { eyebrow, title, description, action, className }: {
    eyebrow: string
    title: string
    description?: ReactNode
    action?: ReactNode
    className?: string
  },
) {
  return (
    <div className={`account-settings-heading${className ? ` ${className}` : ''}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-heading-description">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function AccountSettingsHeader({ title, returnPath, anchor }: {
  title: string
  returnPath?: string
  anchor?: string
}) {
  const backHref = `${returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'}${
    anchor ? `#${anchor}` : ''}`
  return (
    <PageHeading
      eyebrow="account settings"
      title={title}
      action={<a className="profile-edit-link" href={backHref}>back</a>}
    />
  )
}
