import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { appName, appOrigin } from './brand'
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
    .replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

function button(label: string, url: string) {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:20px auto"><tr><td align="center" bgcolor="#749668"><a href="${
    escapeHtml(url)
  }" style="display:inline-block;padding:10px 14px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border:1px solid #749668">${
    escapeHtml(label)
  } <span aria-hidden="true">→</span></a></td></tr></table>`
}

function notice(content: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr><td align="center" style="padding:12px 14px;color:#6f766c;background:#ffffff;border:1px solid #d9dbd4;border-left:3px solid #749668;font-size:12px;line-height:1.6;text-align:center">${content}</td></tr></table>`
}

function emailDocument(heading: string, content: string, preheader = heading) {
  const name = escapeHtml(appName())
  const origin = appOrigin()
  const logo = origin
    ? `<img src="${
      escapeHtml(new URL('/email-logo.png?v=1', origin).href)
    }" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:8px;border:0;vertical-align:-6px">`
    : '<span style="display:inline-block;margin-right:8px;color:#749668;font-size:20px;font-weight:800;letter-spacing:-5px;vertical-align:-2px" aria-hidden="true">&gt;_</span>'
  const brand = origin
    ? `<a href="${
      escapeHtml(origin)
    }" style="display:inline-block;color:#20231f;text-decoration:none" aria-label="${name}">`
    : '<span style="display:inline-block;color:#20231f">'
  const brandEnd = origin ? '</a>' : '</span>'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${
    escapeHtml(heading)
  } · ${name}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:#20231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${
    escapeHtml(preheader)
  }&#847; &zwnj;&nbsp;&#847; &zwnj;&nbsp;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace">
<tr><td align="center" style="padding:0 0 16px;text-align:center">${brand}${logo}<span style="font-size:18px;font-weight:800;letter-spacing:-1px">${name}</span>${brandEnd}</td></tr>
<tr><td align="center" bgcolor="#f1f5ee" style="padding:28px 30px;background:#f1f5ee;border:1px solid #d9dbd4;text-align:center">
<h1 style="margin:0 0 16px;color:#55734a;font-size:20px;line-height:1.35;letter-spacing:-0.5px">${
    escapeHtml(heading)
  }</h1>
<div style="color:#3f443d;font-size:13px;line-height:1.65">${content}</div>
</td></tr>
<tr><td align="center" style="padding:14px 0 0;color:#8a9085;font-size:11px;line-height:1.5;text-align:center">Sent by ${name}${
    origin
      ? ` · <a href="${escapeHtml(origin)}" style="color:#55734a;text-decoration:none">${
        escapeHtml(new URL(origin).host)
      }</a>`
      : ''
  }</td></tr>
</table></td></tr></table></body></html>`
}

const paragraph = (content: string) => `<p style="margin:0 0 16px">${content}</p>`
const expiryNotice = (message: string) =>
  notice(`${escapeHtml(message)}<br>If you did not request this, you can safely ignore this email.`)

export function sendAdminEmail(email: string, subject: string, body: string) {
  const content = `<div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(body)}</div>`
  return sendEmail(email, subject, body, emailDocument(subject, content))
}

export function sendPasswordReset(email: string, resetUrl: string) {
  const name = appName()
  const heading = 'Reset your password'
  return sendEmail(email, `Reset your ${name} password`,
    `Use this link to reset your ${name} password:\n\n${resetUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    emailDocument(heading, paragraph(`We received a request to reset your ${escapeHtml(name)} password.`)
      + button('Reset password', resetUrl) + expiryNotice('This link expires in one hour.'),
      `Reset your ${name} password. This link expires in one hour.`))
}

export function sendEmailVerification(email: string, verificationUrl: string, changing = false) {
  const action = changing ? 'Confirm new email' : 'Verify email'
  return sendEmail(email, `${action} for ${appName()}`,
    `${action} by opening this link:\n\n${verificationUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    emailDocument(action, paragraph(changing
      ? 'Confirm this address to finish changing the email on your account.'
      : 'Confirm this address to finish setting up your account.')
      + button(action, verificationUrl)
      + expiryNotice('This link expires in one hour.')))
}

export function sendAccountDeletionConfirmation(email: string, handle: string, confirmationUrl: string) {
  const name = appName()
  const accountHandle = `@${handle}`
  return sendEmail(email, `Confirm account deletion for ${accountHandle} · ${name}`,
    `Confirm deletion of your ${name} account ${accountHandle} by opening this link:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, secure your account by signing out other sessions.`,
    emailDocument(`Delete ${escapeHtml(accountHandle)}?`, paragraph(
      `A request was made to delete your ${escapeHtml(name)} account <strong>${escapeHtml(accountHandle)}</strong>.`,
    )
      + button(`Review deletion of ${accountHandle}`, confirmationUrl)
      + notice(
        'This link expires in one hour.<br>If this was not you, sign out other sessions to secure your account.',
      )))
}

export function sendPasswordEnableConfirmation(email: string, confirmationUrl: string) {
  const name = appName()
  return sendEmail(email, `Enable password login · ${name}`,
    `Use this link to set a password for your ${name} account:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    emailDocument('Enable password login',
      paragraph(`Set a password to add password login to your ${escapeHtml(name)} account.`)
        + button('Set a password', confirmationUrl) + expiryNotice('This link expires in one hour.')))
}

export function sendEmailChangeAuthorization(email: string, confirmationUrl: string) {
  const name = appName()
  return sendEmail(email, `Approve email change · ${name}`,
    `Approve the requested change to your ${name} account email:\n\n${confirmationUrl}\n\nThis link expires in one hour. If you did not request it, secure your account by signing out other sessions.`,
    emailDocument('Approve email change',
      paragraph(`A request was made to change the email on your ${escapeHtml(name)} account.`)
        + button('Review email change', confirmationUrl)
        + notice(
          'This link expires in one hour.<br>If this was not you, sign out other sessions to secure your account.',
        )))
}

export function sendMagicLink(email: string, magicUrl: string, code: string, handle?: string) {
  const heading = handle ? `Welcome back, @${handle}` : 'Join the community'
  const name = appName()
  const codeBlock =
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 20px"><tr><td align="center" style="padding:10px 14px;color:#20231f;background:#ffffff;border:1px solid #d9dbd4;font-size:20px;font-weight:800;letter-spacing:5px;text-align:center">${
      escapeHtml(code)
    }</td></tr></table>`
  return sendEmail(email, `${heading} · ${name}`,
    `${heading}\n\nOpen this magic link to enter ${name}:\n\n${magicUrl}\n\nAlternatively, enter this six-digit code: ${code}\n\nThe link and code expire in 15 minutes and can only be used once. If you did not request them, you can ignore this email.`,
    emailDocument(heading,
      paragraph(`Use this secure magic link to enter ${escapeHtml(name)}.`) + button(`Enter ${name}`, magicUrl)
        + paragraph('Or enter this six-digit code:') + codeBlock
        + expiryNotice('The link and code expire in 15 minutes and can only be used once.'),
      `Your secure sign-in link and code for ${name}.`))
}

export function sendFriendInvitation(email: string, magicUrl: string, handle: string) {
  const name = appName()
  const heading = `You've been invited to ${name}`
  const invitation = `Your friend @${handle} has invited you to join ${name}.`
  return sendEmail(email, heading,
    `${invitation}\n\nClick on this magic link to join:\n\n${magicUrl}\n\nThis link expires in one week and can only be used once.`,
    emailDocument(heading, paragraph(`${escapeHtml(invitation)}`)
      + paragraph('Click on this magic link to join.')
      + button(`Join ${name}`, magicUrl)
      + notice('This link expires in one week and can only be used once.'),
      `${invitation} Click on this magic link to join.`))
}

export function sendReportReceipt(email: string, reference: string) {
  const safeReference = escapeHtml(reference)
  return sendEmail(email, `Report received · ${reference}`,
    `We received your report of allegedly illegal activity. Reference: ${reference}. We will email our decision and available redress.`,
    emailDocument('Report received', paragraph('We received your report of allegedly illegal activity.')
      + paragraph(`Reference: <strong style="color:#20231f">${safeReference}</strong>`)
      + notice('Keep this reference for your records. We will email our decision and available redress.')))
}

export function sendReportDecision(email: string, reference: string, decision: string, reasons: string) {
  const redress =
    'You may reply to request human reconsideration and may pursue any available out-of-court or judicial remedy.'
  return sendEmail(email, `Report decision · ${reference}`,
    `Decision: ${decision}\n\nReasons: ${reasons}\n\nNo automated means made this decision.\n\n${redress}`,
    emailDocument('Report decision', paragraph(`Reference: <strong>${escapeHtml(reference)}</strong>`)
      + paragraph(`Decision: <strong>${escapeHtml(decision)}</strong>`) + paragraph(`Reasons: ${escapeHtml(reasons)}`)
      + notice(`No automated means made this decision.<br><br>${escapeHtml(redress)}`)))
}
