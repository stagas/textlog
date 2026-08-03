import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Auth, postTitle } from './components/pages'

describe('postTitle', () => {
  test('uses short post text as-is', () => {
    expect(postTitle('A short note')).toBe('A short note')
  })

  test('collapses whitespace for use in the document title', () => {
    expect(postTitle('A note\nwith   uneven spacing')).toBe('A note with uneven spacing')
  })

  test('truncates long post text with an ellipsis', () => {
    const title = postTitle('x'.repeat(61))
    expect(title).toBe(`${'x'.repeat(59)}…`)
    expect(Array.from(title)).toHaveLength(60)
  })
})

describe('Auth', () => {
  test('login accepts an email address or handle', () => {
    const html = renderToStaticMarkup(React.createElement(Auth, { mode: 'login' }))

    expect(html).toContain('email or handle')
    expect(html).toContain('autoComplete="username"')
    expect(html).not.toContain('pattern="[A-Za-z0-9_]{2,24}"')
  })

  test('signup keeps handle validation', () => {
    const html = renderToStaticMarkup(React.createElement(Auth, { mode: 'signup' }))

    expect(html).toContain('pattern="[A-Za-z0-9_]{2,24}"')
  })
})
