import { appName } from './brand'

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

export function interactedEmail(requestOrigin: string, unsubscribeToken: string) {
  const name = appName()
  const origin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : new URL(requestOrigin).origin
  const logoUrl = new URL('/email-logo.png?v=1', origin).href
  const activityUrl = new URL('/to-me', origin).href
  const unsubscribeUrl = new URL(
    `/account/interacted-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
    origin,
  ).href
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>People have interacted with you · ${escapeHtml(name)}</title></head>
<body style="margin:0;padding:0;background:#e9eee6;color:#20231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">People have interacted with you on ${escapeHtml(name)}. Go check it out.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e9eee6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace">
  <tr><td align="center" style="padding:0 0 14px">
    <a href="${escapeHtml(origin)}" style="display:inline-block;color:#20231f;text-decoration:none">
      <img src="${escapeHtml(logoUrl)}" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:5px;border:0;vertical-align:-6px"><span style="font-size:18px;font-weight:800;letter-spacing:-1px">${escapeHtml(name)}</span>
    </a>
  </td></tr>
  <tr><td bgcolor="#f1f5ee" style="padding:38px 32px;border:1px solid #d9dbd4;text-align:center">
    <div style="margin-bottom:11px;color:#749668;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Your conversations</div>
    <h1 style="margin:0 0 14px;color:#55734a;font-size:25px;line-height:1.3;letter-spacing:-1px">People have interacted with you.</h1>
    <p style="margin:0 auto 24px;max-width:430px;color:#3f443d;font-size:13px;line-height:1.7">Someone replied to one of your notes. Head back to ${escapeHtml(name)} to see what they said and continue the conversation.</p>
    <a href="${escapeHtml(activityUrl)}" style="display:inline-block;padding:11px 17px;color:#ffffff;background:#55734a;border:1px solid #49643f;text-decoration:none;font-size:13px;font-weight:700">Go check it out →</a>
  </td></tr>
  <tr><td align="center" style="padding:16px 12px;color:#747a70;font-size:10px;line-height:1.7">
    You received this because interaction emails are enabled for your ${escapeHtml(name)} account.<br>
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#55734a;text-decoration:underline">Unsubscribe from interaction emails</a>
  </td></tr>
</table></td></tr></table></body></html>`
}

