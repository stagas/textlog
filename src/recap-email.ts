import type { Database } from 'bun:sqlite'
import { appName } from './brand'
import { markdownPlainText } from './markdown'
import { issueRecapUnsubscribeToken } from './recap-emails'

// Add note IDs here, in the order they should appear in the recap email.
export const RECAP_POPULAR_NOTE_IDS: readonly number[] = [925, 544, 1078, 771, 1174, 142, 864, 788, 11]

type RecapNote = { id: number; body: string; handle: string }

const milestones = [
  {
    marker: '01',
    title: 'Write it your way',
    path: '/write',
    copy: () => 'Notes grew support for links, code, LaTeX, unicode tags, emoji, previews, and smarter writing helpers.',
  },
  {
    marker: '02',
    title: 'Find your people',
    path: null,
    copy: (origin: string) => `${emailLink('Full-text search', '/search', origin)}, ${
      emailLink('trending tags, profiles, follows, tag communities, and helpful popovers', '/explore', origin)
    } make discovery easy.`,
  },
  {
    marker: '03',
    title: 'Follow the conversation',
    path: '/hot',
    copy: (origin: string) => `Threaded replies, backlinks, ${
      emailLink('jump-to-unread and activity in For You', '/for-you', origin)
    }, and ${emailLink('To Me', '/to-me', origin)} keep every conversation connected.`,
  },
  {
    marker: '04',
    title: 'Make it feel like yours',
    path: '/account/edit/appearance',
    copy: () => 'Choose your theme, accent, typeface, font size, density, page size, timezone, and link-preview preference.',
  },
  {
    marker: '05',
    title: 'Stay close, anywhere',
    path: null,
    copy: (origin: string) => `${emailLink('Notifications', '/account/edit/notifications', origin)}, ${
      emailLink('multiple accounts', '/account/accounts', origin)
    }, and ${
      emailLink('password or magic-link entry and private personalized feeds', '/account/security', origin)
    } keep you in the loop.`,
  },
  {
    marker: '06',
    title: 'Built to travel',
    path: null,
    copy: (origin: string) => `${emailLink('RSS', '/latest.rss', origin)} and ${
      emailLink('Atom feeds', '/latest.atom', origin)
    }, ${emailLink('embeds', '/api/embed-examples', origin)}, ${
      emailLink('a documented API with write access', '/api', origin)
    }, and ${
      emailLink('a public archive', '/dump.zip', origin)
    } make your words portable.`,
  },
  {
    marker: '07',
    title: 'Textlog in your pocket',
    path: null,
    copy: (origin: string) => `${
      emailLink('A mobile app for Android phones', 'https://github.com/Faultless/textlog_flutter', origin)
    }, created by ${emailLink('Serge Kamel aka Faultless', 'https://frontendienst.nl/', origin)}.`,
  },
] as const

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

function emailLink(label: string, path: string, origin: string) {
  const href = new URL(path, origin).href
  return `<a href="${escapeHtml(href)}" style="color:#55734a;text-decoration:underline;text-decoration-color:#aab9a4;text-underline-offset:2px">${
    escapeHtml(label)
  }</a>`
}

function recapNotes(database: Database) {
  if (!RECAP_POPULAR_NOTE_IDS.length) return []
  const placeholders = RECAP_POPULAR_NOTE_IDS.map(() => '?').join(',')
  const notes = database.query(`SELECT p.id,p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`).all(...RECAP_POPULAR_NOTE_IDS) as RecapNote[]
  const byId = new Map(notes.map(note => [note.id, note]))
  return RECAP_POPULAR_NOTE_IDS.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
}

function featureRows(origin: string) {
  return milestones.map(feature =>
    `<tr><td style="padding:0 0 10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="38" valign="top" style="width:38px;padding-top:2px;color:#749668;font-size:11px;font-weight:700">${feature.marker}</td>
      <td style="padding:0 0 10px;border-bottom:1px solid #d9dbd4">
        <div style="margin:0 0 4px;color:#20231f;font-size:14px;font-weight:700">${
          feature.path ? emailLink(feature.title, feature.path, origin) : escapeHtml(feature.title)
        }</div>
        <div style="color:#60665e;font-size:12px;line-height:1.6">${feature.copy(origin)}</div>
      </td>
    </tr></table>
  </td></tr>`
  ).join('')
}

function popularNotes(notes: RecapNote[], origin: string) {
  if (!notes.length) return ''
  const cards = notes.map(note => {
    const excerpt = markdownPlainText(note.body)
    const shortened = excerpt.length > 240 ? `${excerpt.slice(0, 237).trimEnd()}…` : excerpt
    const url = new URL(`/post/${note.id}`, origin).href
    return `<tr><td style="padding:0 0 10px">
      <a href="${
      escapeHtml(url)
    }" style="display:block;padding:14px;color:#20231f;background:#ffffff;border:1px solid #d9dbd4;text-decoration:none">
        <div style="margin:0 0 8px;color:#55734a;font-size:11px;font-weight:700">@${escapeHtml(note.handle)}</div>
        <div style="font-size:12px;line-height:1.6">${escapeHtml(shortened)}</div>
        <div style="margin-top:9px;color:#749668;font-size:11px;font-weight:700">read the conversation →</div>
      </a>
    </td></tr>`
  }).join('')
  return `<tr><td style="padding:26px 30px 8px">
    <div style="margin-bottom:5px;color:#8a9085;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">From the community</div>
    <h2 style="margin:0 0 14px;color:#20231f;font-size:17px;line-height:1.35">Notes we kept thinking about</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cards}</table>
  </td></tr>`
}

export function recapEmail(database: Database, requestOrigin: string, unsubscribeToken: string) {
  const name = appName()
  const origin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : new URL(requestOrigin).origin
  const logoUrl = new URL('/email-logo.png?v=1', origin).href
  const hotUrl = new URL('/hot', origin).href
  const unsubscribeUrl = new URL(
    `/account/recap-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
    origin,
  ).href
  const notes = recapNotes(database)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>A lot has happened · ${escapeHtml(name)}</title></head>
<body style="margin:0;padding:0;background:#e9eee6;color:#20231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">A launch recap: better writing, discovery, conversations, notifications, feeds, and more.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e9eee6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace">
  <tr><td align="center" style="padding:0 0 14px">
    <a href="${escapeHtml(origin)}" style="display:inline-block;color:#20231f;text-decoration:none">
      <img src="${
    escapeHtml(logoUrl)
  }" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:8px;border:0;vertical-align:-6px">
      <span style="font-size:18px;font-weight:800;letter-spacing:-1px">${escapeHtml(name)}</span>
    </a>
  </td></tr>
  <tr><td bgcolor="#f1f5ee" style="border:1px solid #d9dbd4">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:34px 30px 30px;border-bottom:1px solid #d9dbd4">
        <div style="margin-bottom:10px;color:#749668;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Since launch</div>
        <h1 style="margin:0 0 14px;color:#55734a;font-size:25px;line-height:1.25;letter-spacing:-1px">A lot has happened.<br>Quietly, of course.</h1>
        <p style="margin:0;color:#3f443d;font-size:13px;line-height:1.7">We started with a simple place to write. Since then, ${
    escapeHtml(name)
  } has become more expressive, more personal, and easier to carry with you—without getting any louder.</p>
      </td></tr>
      <tr><td style="padding:26px 30px 10px">
        <div style="margin-bottom:5px;color:#8a9085;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">What’s new</div>
        <h2 style="margin:0 0 17px;color:#20231f;font-size:17px;line-height:1.35">The short version</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${featureRows(origin)}</table>
      </td></tr>
      ${popularNotes(notes, origin)}
      <tr><td align="center" style="padding:22px 30px 32px">
        <p style="margin:0 0 16px;color:#60665e;font-size:12px;line-height:1.65">There’s more to find, and plenty more to come. Thanks for making this small corner of the internet feel alive.</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#749668">
          <a href="${
    escapeHtml(hotUrl)
  }" style="display:inline-block;padding:11px 15px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border:1px solid #749668">See what’s happening →</a>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:14px 0 0;color:#8a9085;font-size:11px;line-height:1.8">
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#55734a;text-decoration:underline">Unsubscribe from recap emails</a><br>
    Sent by ${escapeHtml(name)} · <a href="${escapeHtml(origin)}" style="color:#55734a;text-decoration:none">${
      escapeHtml(new URL(origin).host)
    }</a>
  </td></tr>
</table></td></tr></table></body></html>`
}

export function recapEmailForUser(database: Database, requestOrigin: string, userId: number) {
  return recapEmail(database, requestOrigin, issueRecapUnsubscribeToken(database, userId))
}
