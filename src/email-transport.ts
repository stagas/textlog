import nodemailer from 'nodemailer'

export type EmailMessage = {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

export type EmailTransport = {
  send(message: EmailMessage): Promise<void>
}

type Environment = Record<string, string | undefined>

async function responseError(provider: string, response: Response) {
  const detail = (await response.text()).trim()
  return new Error(`${provider} returned ${response.status}${detail ? `: ${detail}` : ''}`)
}

function resendTransport(apiKey: string, request: typeof fetch): EmailTransport {
  return {
    async send(message) {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...message, to: [message.to] }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw await responseError('Resend', response)
    },
  }
}

function sendGridTransport(apiKey: string, request: typeof fetch): EmailTransport {
  return {
    async send(message) {
      const response = await request('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: parseSender(message.from),
          subject: message.subject,
          content: [
            { type: 'text/plain', value: message.text },
            { type: 'text/html', value: message.html },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw await responseError('SendGrid', response)
    },
  }
}

function parseSender(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  return match ? { name: match[1].replace(/^['"]|['"]$/g, ''), email: match[2] } : { email: value.trim() }
}

function googleTransport(user: string, password: string): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  })
  return { send: async message => { await transporter.sendMail(message) } }
}

export function emailProvider(env: Environment = Bun.env) {
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase() || 'resend'
  if (provider === 'resend' || provider === 'sendgrid' || provider === 'google') return provider
  throw new Error('EMAIL_PROVIDER must be resend, sendgrid, or google')
}

export function createEmailTransport(env: Environment = Bun.env, request: typeof fetch = fetch): EmailTransport {
  switch (emailProvider(env)) {
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY must be configured')
      return resendTransport(env.RESEND_API_KEY, request)
    case 'sendgrid':
      if (!env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY must be configured')
      return sendGridTransport(env.SENDGRID_API_KEY, request)
    case 'google':
      if (!env.GOOGLE_SMTP_USER || !env.GOOGLE_SMTP_APP_PASSWORD) {
        throw new Error('GOOGLE_SMTP_USER and GOOGLE_SMTP_APP_PASSWORD must be configured')
      }
      return googleTransport(env.GOOGLE_SMTP_USER, env.GOOGLE_SMTP_APP_PASSWORD)
  }
}
