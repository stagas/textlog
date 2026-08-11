import { afterEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { appHost, appHostname, appIdentifier, appName, appOrigin, clientIpHeaderName, sessionCookieName } from './brand'
import { Layout } from './components/layout'
import { sessionCookie } from './http'
import { sessionToken } from './utils'

const original = {
  APP_NAME: Bun.env.APP_NAME,
  APP_URL: Bun.env.APP_URL,
  EMAIL_FROM: Bun.env.EMAIL_FROM,
}

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete Bun.env[key]
    else Bun.env[key] = value
  }
})

describe('instance branding', () => {
  test('uses the configured name, public origin, host, and sender address', () => {
    Bun.env.APP_NAME = 'Notebook Garden'
    Bun.env.APP_URL = 'https://notes.example.org/'
    Bun.env.EMAIL_FROM = 'Notebook Garden <hello@notes.example.org>'

    expect(appName()).toBe('Notebook Garden')
    expect(appOrigin()).toBe('https://notes.example.org')
    expect(appHost()).toBe('notes.example.org')
    expect(appHostname()).toBe('notes.example.org')
    expect(appIdentifier()).toBe('notebook-garden')
    expect(sessionCookieName()).toBe('notebook-garden')
    expect(clientIpHeaderName()).toBe('x-notebook-garden-client-ip')
    expect(sessionCookie('secret')).toStartWith('notebook-garden=secret;')
    expect(sessionToken(new Request('https://notes.example.org', {
      headers: { cookie: 'other=value; notebook-garden=secret' },
    }))).toBe('secret')

    const html = renderToStaticMarkup(React.createElement(Layout, null, React.createElement('p', null, 'Hello')))
    expect(html).toContain('<title>Notebook Garden</title>')
    expect(html).toContain('aria-label="Notebook Garden home"')
    expect(html).toContain('<span>notes.example.org</span>')
    expect(html).not.toContain('textlog.cc')
  })
})
