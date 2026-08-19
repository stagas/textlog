import React from 'react'
import { activeRequest } from '../theme'

export function LogoutForm({ children }: { children: React.ReactNode }) {
  const url = new URL(activeRequest().url)
  const returnTo = url.pathname + url.search
  return (
    <form method="post" action="/logout">
      <input type="hidden" name="returnTo" value={returnTo} />
      {children}
    </form>
  )
}
