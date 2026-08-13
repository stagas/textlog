export function AccountSettingsHeader({ title, returnPath }: { title: string; returnPath?: string }) {
  const backHref = returnPath ? `/account/edit?from=${encodeURIComponent(returnPath)}` : '/account/edit'
  return (
    <div className="account-settings-heading">
      <div>
        <p className="eyebrow">account settings</p>
        <h1>{title}</h1>
      </div>
      <a className="profile-edit-link" href={backHref}>back</a>
    </div>
  )
}
