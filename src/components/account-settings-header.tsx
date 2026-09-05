import type { ReactNode } from 'preact/compat'

export function PageHeading(
  { eyebrow, title, description, action, titleAction, className }: {
    eyebrow: string
    title: string
    description?: ReactNode
    action?: ReactNode
    titleAction?: ReactNode
    className?: string
  },
) {
  return (
    <div className={`account-settings-heading${className ? ` ${className}` : ''}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <div className="account-settings-title-row">
          <h1>{title}</h1>
          {titleAction}
        </div>
        {description && <p className="page-heading-description">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function AccountSettingsHeader({ title, returnPath, anchor, titleAction }: {
  title: string
  returnPath?: string
  anchor?: string
  titleAction?: ReactNode
}) {
  const backHref = `${returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'}${
    anchor ? `#${anchor}` : ''
  }`
  return (
    <PageHeading
      eyebrow="account settings"
      title={title}
      titleAction={titleAction}
      action={<a className="profile-edit-link" href={backHref}>back</a>}
    />
  )
}
