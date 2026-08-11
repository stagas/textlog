import { describe, expect, test } from 'bun:test'
import { createEmailTransport } from './email-transport'

const message = {
  from: 'Textlog <hello@example.com>',
  to: 'reader@example.com',
  subject: 'Welcome',
  text: 'Hello',
  html: '<p>Hello</p>',
}

describe('email transports', () => {
  test('sends Resend API payloads', async () => {
    let request: { url: string; init: RequestInit } | undefined
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init: init! }
      return new Response(null, { status: 200 })
    }) as typeof fetch

    await createEmailTransport({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'secret' }, fetchMock).send(message)

    expect(request?.url).toBe('https://api.resend.com/emails')
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      from: message.from, to: [message.to], subject: message.subject,
    })
  })

  test('sends SendGrid API payloads and parses the sender', async () => {
    let request: { url: string; init: RequestInit } | undefined
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init: init! }
      return new Response(null, { status: 202 })
    }) as typeof fetch

    await createEmailTransport({ EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'secret' }, fetchMock).send(message)

    const body = JSON.parse(String(request?.init.body))
    expect(request?.url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect(body.from).toEqual({ name: 'Textlog', email: 'hello@example.com' })
    expect(body.personalizations[0].to[0].email).toBe(message.to)
    expect(body.content).toHaveLength(2)
  })

  test('reports provider failures without losing the response status', async () => {
    const fetchMock = (async () => new Response('rejected', { status: 429 })) as unknown as typeof fetch
    expect(createEmailTransport({ EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'secret' }, fetchMock).send(message))
      .rejects.toThrow('SendGrid returned 429: rejected')
  })

  test('requires Google SMTP credentials', () => {
    expect(() => createEmailTransport({ EMAIL_PROVIDER: 'google', GOOGLE_SMTP_USER: 'sender@example.com' }))
      .toThrow('GOOGLE_SMTP_USER and GOOGLE_SMTP_APP_PASSWORD must be configured')
  })
})
