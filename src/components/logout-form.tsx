import React from 'react'

export function LogoutForm({ children }: { children: React.ReactNode }) {
  return (
    <form method="post" action="/logout">
      {children}
    </form>
  )
}
