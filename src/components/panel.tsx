import React from 'react'

export type PanelWidth = 'narrow' | 'medium' | 'wide' | 'fluid'
export type PanelTone = 'default' | 'danger'

export function Panel({ children, className = '', width = 'medium', tone = 'default', as = 'div', ...props }: {
  children: React.ReactNode
  className?: string
  width?: PanelWidth
  tone?: PanelTone
  as?: 'div' | 'section' | 'article' | 'form'
  method?: string
  action?: string
} & React.HTMLAttributes<HTMLElement>) {
  const Element = as
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
