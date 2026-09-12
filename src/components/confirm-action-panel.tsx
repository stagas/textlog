import React from 'preact/compat'
import type { User } from '../types'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { Panel, PanelCopy, PanelHeading } from './panel'

export function ConfirmActionPanel({ user, pageTitle, eyebrow, heading, copy, preview, formAction, cancelHref,
  submitLabel, danger = false, children }: {
    user: User
    pageTitle: string
    eyebrow: string
    heading: React.ReactNode
    copy: React.ReactNode
    preview?: React.ReactNode
    formAction: string
    cancelHref: string
    submitLabel: React.ReactNode
    danger?: boolean
    children?: React.ReactNode
  }) {
  return (
    <Layout user={user} title={pageTitle}>
      <Panel className="confirm-delete admin-confirm">
        <p className="eyebrow">{eyebrow}</p>
        <PanelHeading as="h1">{heading}</PanelHeading>
        <PanelCopy>{copy}</PanelCopy>
        {preview}
        <form method="post" action={formAction}>
          {children}
          <FormActions secondary={<a className="secondary-action cancel-action" href={cancelHref}>cancel</a>}
            primary={<button className={`button${danger ? ' button-danger' : ''}`} type="submit">{submitLabel}</button>}
          />
        </form>
      </Panel>
    </Layout>
  )
}
