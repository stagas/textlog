import type { User } from '../types'
import { PageHeading } from './account-settings-header'
import { Layout } from './layout'
import { FormActions } from './page-shared'
import { CenteredPanel, Panel, PanelCopy, PanelHeading } from './panel'

function SampleContent({ title, eyebrow, danger = false }: { title: string; eyebrow: string; danger?: boolean }) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <PanelHeading>{title}</PanelHeading>
      <PanelCopy>
        Representative supporting copy for checking measure, spacing, contrast, and wrapping.
      </PanelCopy>
      <FormActions secondary={danger
        ? <button className="secondary-action cancel-action" type="button">cancel</button>
        : <button className="secondary-action" type="button">secondary</button>}
        primary={<button className={`button${danger ? ' button-danger' : ''}`} type="button">primary action</button>} />
    </>
  )
}

export function PanelsGallery({ user }: { user?: User | null }) {
  return (
    <Layout user={user} title="panels gallery">
      <div className="panels-gallery">
        <PageHeading className="panels-gallery-header" eyebrow="design audit" title="panels gallery"
          description="Shared panel primitives and current content patterns, rendered together for visual comparison." />
        <section className="panel-gallery-section" aria-labelledby="gallery-widths">
          <h2 id="gallery-widths">Widths</h2>
          <Panel width="narrow">
            <SampleContent eyebrow="narrow · 440px" title="Authentication panel" />
          </Panel>
          <Panel width="medium">
            <SampleContent eyebrow="medium · 560px" title="Confirmation panel" />
          </Panel>
          <Panel width="wide">
            <SampleContent eyebrow="wide · 620px" title="Welcome panel" />
          </Panel>
          <Panel width="fluid">
            <SampleContent eyebrow="fluid" title="Settings or form panel" />
          </Panel>
        </section>
        <section className="panel-gallery-section" aria-labelledby="gallery-states">
          <h2 id="gallery-states">States and content</h2>
          <div className="panel-gallery-grid">
            <Panel width="fluid">
              <p className="eyebrow">form</p>
              <h2>Enter your details</h2>
              <form className="panel-gallery-form">
                <label className="form-label">
                  email<input className="form-control" type="email" placeholder="you@example.com" />
                </label>
                <label className="form-label">
                  message<textarea className="form-control" rows={3} />
                </label>
                <button className="button" type="button">continue →</button>
              </form>
            </Panel>
            <Panel width="fluid" tone="danger">
              <SampleContent eyebrow="destructive action" title="Delete this item?" danger />
            </Panel>
            <Panel width="fluid" className="panel-gallery-state">
              <p className="eyebrow">status</p>
              <div className="panel-gallery-state-content">
                <PanelHeading>Check your email</PanelHeading>
                <p className="status-message status-success" role="status">A fresh verification link has been sent.</p>
                <PanelCopy>The link expires in one hour.</PanelCopy>
              </div>
            </Panel>
            <Panel width="fluid" className="panel-gallery-state">
              <p className="eyebrow">error</p>
              <div className="panel-gallery-state-content">
                <PanelHeading>Something needs attention</PanelHeading>
                <p className="status-message status-error" role="alert">Review the highlighted information.</p>
                <button className="button" type="button">try again</button>
              </div>
            </Panel>
          </div>
        </section>
        <section className="panel-gallery-section" aria-labelledby="gallery-centered">
          <h2 id="gallery-centered">Centered page treatment</h2>
          <div className="panel-gallery-shell-preview">
            <CenteredPanel width="narrow">
              <SampleContent eyebrow="centered shell" title="Log in" />
            </CenteredPanel>
          </div>
        </section>
      </div>
    </Layout>
  )
}
