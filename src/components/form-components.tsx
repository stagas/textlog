import React from 'preact/compat'

export function FormMessage({ error, success, dismissible = true, className = '' }: {
  error?: React.ReactNode
  success?: React.ReactNode
  dismissible?: boolean
  className?: string
}) {
  if (!error && !success) return null
  return (
    <p className={`status-message ${error ? 'status-error' : 'status-success'}${className ? ` ${className}` : ''}`}
      role={error ? 'alert' : 'status'}>
      <span>{error || success}</span>
      {error && dismissible && (
        <label className="status-message-dismiss" title="Dismiss error">
          <input className="visually-hidden" type="checkbox" />
          <span className="status-message-dismiss-icon" aria-hidden="true" />
          <span className="visually-hidden">Dismiss error</span>
        </label>
      )}
    </p>
  )
}

export function FormActions({ primary, secondary, className = '' }: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`form-actions${className ? ` ${className}` : ''}`}>
      {secondary && <span className="form-actions-secondary">{secondary}</span>}
      {primary}
    </div>
  )
}

export function ActionPair({ primary, secondary, className = '' }: {
  primary: React.ReactNode
  secondary: React.ReactNode
  className?: string
}) {
  return (
    <div className={`action-pair${className ? ` ${className}` : ''}`}>
      {primary}
      <span className="action-separator">or</span>
      {secondary}
    </div>
  )
}
