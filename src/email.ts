import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

async function sendEmail(email: string, subject: string, text: string, html: string) {
  const capturePath = Bun.env.EMAIL_CAPTURE_PATH
  if (capturePath) {
    if (Bun.env.NODE_ENV !== 'test') throw new Error('EMAIL_CAPTURE_PATH is only available in test')
    mkdirSync(dirname(capturePath), { recursive: true })
    appendFileSync(capturePath, `${JSON.stringify({ to: email, subject, text, html })}\n`, { mode: 0o600 })
    return
  }

  const apiKey = Bun.env.RESEND_API_KEY
  const from = Bun.env.EMAIL_FROM
  if (!apiKey || !from) throw new Error('RESEND_API_KEY and EMAIL_FROM must be configured')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`)
}

export function sendPasswordReset(email: string, resetUrl: string) {
  return sendEmail(email, 'Reset your textlog password',
    `Use this link to reset your textlog password:\n\n${resetUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    `<p>Use the link below to reset your textlog password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`)
}

export function sendEmailVerification(email: string, verificationUrl: string, changing = false) {
  const action = changing ? 'Confirm new email' : 'Verify email'
  return sendEmail(email, `${action} for textlog`,
    `${action} by opening this link:\n\n${verificationUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    `<p>${action} by using the link below.</p><p><a href="${verificationUrl}">${action}</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`)
}

export function sendMagicLink(email: string, magicUrl: string, handle?: string) {
  const heading = handle ? `Welcome back, @${handle}` : 'Join the community'
  return sendEmail(email, `${heading} · textlog`,
    `${heading}\n\nOpen this magic link to enter textlog:\n\n${magicUrl}\n\nThis link expires in one hour and can only be used once. If you did not request it, you can ignore this email.`,
    `<h1>${heading}</h1><p>Use this magic link to enter textlog:</p><p><a href="${magicUrl}">Enter textlog</a></p><p>This link expires in one hour and can only be used once. If you did not request it, you can ignore this email.</p>`)
}

export function sendReportReceipt(email: string, reference: string) {
  return sendEmail(email, `Report received · ${reference}`,
    `We received your report of allegedly illegal activity. Reference: ${reference}. We will email our decision and available redress.`,
    `<p>We received your report of allegedly illegal activity.</p><p>Reference: <strong>${reference}</strong></p><p>We will email our decision and available redress.</p>`)
}

export function sendReportDecision(email: string, reference: string, decision: string, reasons: string) {
  const redress =
    'You may reply to request human reconsideration and may pursue any available out-of-court or judicial remedy.'
  return sendEmail(email, `Report decision · ${reference}`,
    `Decision: ${decision}\n\nReasons: ${reasons}\n\nNo automated means made this decision.\n\n${redress}`,
    `<p>Decision: <strong>${decision}</strong></p><p>Reasons: ${reasons}</p><p>No automated means made this decision.</p><p>${redress}</p>`)
}
