import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { appName } from './brand'
import { createEmailTransport } from './email-transport'

async function sendEmail(email: string, subject: string, text: string, html: string) {
  const capturePath = Bun.env.EMAIL_CAPTURE_PATH
  if (capturePath) {
    if (Bun.env.NODE_ENV !== 'test') throw new Error('EMAIL_CAPTURE_PATH is only available in test')
    mkdirSync(dirname(capturePath), { recursive: true })
    appendFileSync(capturePath, `${JSON.stringify({ to: email, subject, text, html })}\n`, { mode: 0o600 })
    return
  }

  const sendDevelopmentEmail = Bun.env.DEV_SEND_EMAILS === 'true' || Bun.env.DEV_RESEND_EMAILS === 'true'
  if (Bun.env.NODE_ENV === 'development' && !sendDevelopmentEmail) return

  const from = Bun.env.EMAIL_FROM
  if (!from) throw new Error('EMAIL_FROM must be configured')
  await createEmailTransport().send({ from, to: email, subject, text, html })
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function sendAdminEmail(email: string, subject: string, body: string) {
  return sendEmail(email, subject, body, `<div style="white-space: pre-wrap">${escapeHtml(body)}</div>`)
}

export function sendPasswordReset(email: string, resetUrl: string) {
  const name = appName()
  return sendEmail(email, `Reset your ${name} password`,
    `Use this link to reset your ${name} password:\n\n${resetUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    `<p>Use the link below to reset your ${name} password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`)
}

export function sendEmailVerification(email: string, verificationUrl: string, changing = false) {
  const action = changing ? 'Confirm new email' : 'Verify email'
  return sendEmail(email, `${action} for ${appName()}`,
    `${action} by opening this link:\n\n${verificationUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    `<p>${action} by using the link below.</p><p><a href="${verificationUrl}">${action}</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`)
}

export function sendAccountDeletionConfirmation(email: string, confirmationUrl: string) {
  const name = appName()
  return sendEmail(email, `Confirm account deletion · ${name}`,
    `Confirm deletion of your ${name} account by opening this link:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, secure your account by signing out other sessions.`,
    `<p>Confirm deletion of your ${name} account using the link below.</p><p><a href="${confirmationUrl}">Review account deletion</a></p><p>This link expires in one hour. If you did not request it, secure your account by signing out other sessions.</p>`)
}

export function sendPasswordEnableConfirmation(email: string, confirmationUrl: string) {
  const name = appName()
  return sendEmail(email, `Enable password login · ${name}`,
    `Use this link to set a password for your ${name} account:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    `<p>Use the link below to set a password for your ${name} account.</p><p><a href="${confirmationUrl}">Set a password</a></p><p>This link expires in one hour. If you did not request it, you can ignore this email.</p>`)
}

export function sendEmailChangeAuthorization(email: string, confirmationUrl: string) {
  const name = appName()
  return sendEmail(email, `Approve email change · ${name}`,
    `Approve the requested change to your ${name} account email:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, secure your account by signing out other sessions.`,
    `<p>Approve the requested change to your ${name} account email.</p><p><a href="${confirmationUrl}">Review email change</a></p><p>This link expires in one hour. If you did not request it, secure your account by signing out other sessions.</p>`)
}

export function sendMagicLink(email: string, magicUrl: string, code: string, handle?: string) {
  const heading = handle ? `Welcome back, @${handle}` : 'Join the community'
  const name = appName()
  return sendEmail(email, `${heading} · ${name}`,
    `${heading}\n\nOpen this magic link to enter ${name}:\n\n${magicUrl}\n\nAlternatively, enter this six-digit code: ${code}\n\nThe link and code expire in 15 minutes and can only be used once. If you did not request them, you can ignore this email.`,
    `<h1>${heading}</h1><p>Use this magic link to enter ${name}:</p><p><a href="${magicUrl}" style="font-size: 24px;">Enter ${name}</a></p><p>Alternatively, enter this six-digit code:</p><p style="font-size: 24px; letter-spacing: 4px;"><strong>${code}</strong></p><p>The link and code expire in 15 minutes and can only be used once. If you did not request them, you can ignore this email.</p>`)
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
