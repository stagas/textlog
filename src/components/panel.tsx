import React from 'preact/compat'

export type PanelWidth = 'narrow' | 'medium' | 'wide' | 'fluid'
export type PanelTone = 'default' | 'danger'

export function PanelHeading({ children, as = 'h2' }: { children: React.ReactNode; as?: 'h1' | 'h2' }) {
  const Element = as as any
  return <Element className="panel-heading">{children}</Element>
}

export function PanelCopy({ children }: { children: React.ReactNode }) {
  return <p className="panel-copy">{children}</p>
}

export function Panel({ children, className = '', width = 'medium', tone = 'default', as = 'div', ...props }: {
  children: React.ReactNode
  className?: string
  width?: PanelWidth
  tone?: PanelTone
  as?: 'div' | 'section' | 'article' | 'form'
  method?: string
  action?: string
} & React.HTMLAttributes<HTMLElement>) {
  const Element = as as any
  const classes = ['panel', 'panel-surface', `panel-${width}`, tone === 'danger' ? 'panel-danger' : '', className]
    .filter(Boolean).join(' ')
  return <Element className={classes} {...props}>{children}</Element>
}

export function CenteredPanel(
  { children, className = '', shellClassName = '', width = 'narrow', tone = 'default', ...props }: {
    children: React.ReactNode
    className?: string
    shellClassName?: string
    width?: PanelWidth
    tone?: PanelTone
  } & React.HTMLAttributes<HTMLElement>,
) {
  return (
    <section className={`panel-shell${shellClassName ? ` ${shellClassName}` : ''}`}>
      <Panel className={className} width={width} tone={tone} {...props}>{children}</Panel>
    </section>
  )
}
