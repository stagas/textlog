import type { Database } from 'bun:sqlite'
import { appName } from './brand'
import { markdownPlainText } from './markdown'
import { issueRecapUnsubscribeToken } from './recap-emails'

// Add note IDs here, in the order they should appear in the recap email.
export const RECAP_POPULAR_NOTE_IDS: readonly number[] = [925, 544, 1078, 771, 1174, 142, 864, 788, 11]

type RecapReply = { id: number; body: string; handle: string }
type RecapNote = { id: number; body: string; handle: string; replyCount?: number; replies?: RecapReply[] }

const milestones = [
  {
    marker: '01',
    title: 'Write it your way',
    path: '/write',
    copy: () =>
      'Notes grew support for links, code, LaTeX, unicode tags, emoji, previews, and smarter writing helpers.',
  },
  {
    marker: '02',
    title: 'Find your people',
    path: null,
    copy: (origin: string) =>
      `${emailLink('Full-text search', '/search', origin)}, ${
        emailLink('trending tags, profiles, follows, tag communities, and helpful popovers', '/explore', origin)
      } make discovery easy.`,
  },
  {
    marker: '03',
    title: 'Follow the conversation',
    path: '/hot',
    copy: (origin: string) =>
      `Threaded replies, backlinks, ${emailLink('jump-to-unread and activity in My Feed', '/my-feed', origin)}, and ${
        emailLink('@', '/@', origin)
      } keep every conversation connected.`,
  },
  {
    marker: '04',
    title: 'Make it feel like yours',
    path: '/account/edit/appearance',
    copy: () => 'Choose your theme, accent, typeface, font size, density, page size, and link-preview preference.',
  },
  {
    marker: '05',
    title: 'Stay close, anywhere',
    path: null,
    copy: (origin: string) =>
      `${emailLink('Notifications', '/account/edit/notifications', origin)}, ${
        emailLink('multiple accounts', '/account/accounts', origin)
      }, and ${
        emailLink('password or magic-link entry and private personalized feeds', '/account/security', origin)
      } keep you in the loop.`,
  },
  {
    marker: '06',
    title: 'Built to travel',
    path: null,
    copy: (origin: string) =>
      `${emailLink('RSS', '/all.rss', origin)} and ${emailLink('Atom feeds', '/all.atom', origin)}, ${
        emailLink('embeds', '/api/embed-examples', origin)
      }, ${emailLink('a documented API with write access', '/api', origin)}, and ${
        emailLink('a public archive', '/dump.zip', origin)
      } make your words portable.`,
  },
  {
    marker: '07',
    title: 'Textlog in your pocket',
    path: null,
    copy: (origin: string) =>
      `${
        emailLink('A mobile app for Android phones', 'https://github.com/Faultless/textlog_flutter', origin)
      }, created by ${emailLink('Serge Kamel aka Faultless', 'https://frontendienst.nl/', origin)}.`,
  },
] as const

const v2Milestones = [
  ['01', 'More ways to write', '/write', 'Tables, lists, highlighted and executable code, LaTeX, maps, polls, quizzes, todos, previews, drafts, and embedded writing.'],
  ['02', 'Conversations that stay readable', '/hot', 'Thread trees, smarter collapsing, anchored replies, backlinks, locks, and contextual navigation for conversations of every size.'],
  ['03', 'Feeds with a point of view', null, 'Direct activity in @, followed people and tags in my feed, active conversations in hot, a fresh mix in any, and the full stream in all.'],
  ['04', 'Discovery with more context', '/explore', 'Search, trending tags, hovercards, tag aliases and display names make people and ideas easier to find.'],
  ['05', 'A more personal textlog', '/account/edit/appearance', 'Moods, pinned notes, bookmarks, streaks, themes, accents, fonts, density, corners, timestamps, and preview controls.'],
  ['06', 'Words across boundaries', null, 'Translation, Unicode hashtags, location cards, audio links, ASCII art, and thoughtful content warnings.'],
  ['07', 'Control without lock-in', '/account/security', 'Multiple accounts, password or magic-link entry, private feeds, export, unpublishing, and deletion keep your writing yours.'],
  ['08', 'Connected on your terms', '/account/edit/notifications', 'Push notifications, interaction and recap emails, broadcast controls, and installable-app support without extra noise.'],
  ['09', 'Built for the wider web', '/api', 'RSS, Atom, embeds, a public archive, and a read/write API for conversations, drafts, bookmarks, and automatic tags.'],
  ['10', 'Still small by design', '/about', 'Server-rendered, text-first, free of likes and engagement tricks, and centered on people writing to one another.'],
] as const

const RECAP_V2_EXCLUDED_NOTE_IDS = [1951, 1274, 2791, 1373, 556, 328, 2361] as const

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\'', '&#39;')
}

function emailLink(label: string, path: string, origin: string) {
  const href = new URL(path, origin).href
  return `<a href="${
    escapeHtml(href)
  }" style="color:#55734a;text-decoration:underline;text-decoration-color:#aab9a4;text-underline-offset:2px">${
    escapeHtml(label)
  }</a>`
}

const responsiveEmailStyles = `<style>
@media only screen and (max-width:480px){
  .email-outer{padding:0!important}
  .email-panel{border-left:0!important;border-right:0!important}
  .email-brand{padding-top:14px!important}
  .email-pad{padding-left:18px!important;padding-right:18px!important}
  .email-hero{padding-top:26px!important;padding-bottom:24px!important}
  .email-heading{font-size:22px!important;letter-spacing:-.6px!important}
  .feature-marker{width:28px!important;font-size:10px!important}
  .note-card{padding:14px 0!important}
  .email-cta{display:block!important;padding:13px 14px!important}
}
</style>`

function recapNotes(database: Database) {
  if (!RECAP_POPULAR_NOTE_IDS.length) return []
  const placeholders = RECAP_POPULAR_NOTE_IDS.map(() => '?').join(',')
  const notes = database.query(`SELECT p.id,p.body,u.handle FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`).all(...RECAP_POPULAR_NOTE_IDS) as RecapNote[]
  const byId = new Map(notes.map(note => [note.id, note]))
  return RECAP_POPULAR_NOTE_IDS.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
}

function recapV2Notes(database: Database) {
  const notes = database.query(`WITH RECURSIVE descendants(root_id,id,deleted_at) AS (
      SELECT p.id,p.id,p.deleted_at FROM posts p WHERE p.parent_id IS NULL
      UNION ALL SELECT descendants.root_id,reply.id,reply.deleted_at FROM posts reply
        JOIN descendants ON reply.parent_id=descendants.id
    ), ranked AS (
      SELECT root_id,sum(CASE WHEN id!=root_id AND deleted_at IS NULL THEN 1 ELSE 0 END) replies
      FROM descendants GROUP BY root_id
    )
    SELECT p.id,p.body,u.handle,ranked.replies reply_count FROM ranked
      JOIN posts p ON p.id=ranked.root_id JOIN users u ON u.id=p.user_id
    WHERE ranked.replies>0 AND p.id NOT IN (${RECAP_V2_EXCLUDED_NOTE_IDS.join(',')})
      AND p.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM post_hashtags ph WHERE ph.post_id=p.id
        AND ph.tag IN ('whisper','meta','tlog','textlog'))
    ORDER BY ranked.replies DESC,p.created_at DESC LIMIT 8`).all() as Array<RecapNote & { reply_count: number }>
  return notes.map(note => {
    const replies = database.query(`WITH RECURSIVE thread(id,user_id,body,created_at,deleted_at) AS (
      SELECT id,user_id,body,created_at,deleted_at FROM posts WHERE parent_id=?
      UNION ALL SELECT reply.id,reply.user_id,reply.body,reply.created_at,reply.deleted_at FROM posts reply
        JOIN thread ON reply.parent_id=thread.id
    ) SELECT thread.id,thread.body,u.handle FROM thread JOIN users u ON u.id=thread.user_id
      WHERE thread.deleted_at IS NULL AND u.deleted_at IS NULL AND u.suspended_at IS NULL
      ORDER BY thread.created_at DESC,thread.id DESC LIMIT 2`).all(note.id) as RecapReply[]
    return { id: note.id, body: note.body, handle: note.handle, replyCount: note.reply_count, replies: replies.reverse() }
  })
}

function featureRows(origin: string) {
  return milestones.map(feature =>
    `<tr><td style="padding:0 0 10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="feature-marker" width="38" valign="top" style="width:38px;padding-top:2px;color:#749668;font-size:11px;font-weight:700">${feature.marker}</td>
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

function featureRowsV2(origin: string) {
  return v2Milestones.map(([marker, title, path, copy]) =>
    `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="feature-marker" width="38" valign="top" style="width:38px;padding-top:2px;color:#749668;font-size:11px;font-weight:700">${marker}</td>
      <td style="padding:0 0 10px;border-bottom:1px solid #d9dbd4">
        <div style="margin:0 0 4px;color:#20231f;font-size:14px;font-weight:700">${
      path ? emailLink(title, path, origin) : escapeHtml(title)
    }</div><div style="color:#60665e;font-size:12px;line-height:1.6">${escapeHtml(copy)}</div>
      </td></tr></table></td></tr>`).join('')
}

function popularNotes(notes: RecapNote[], origin: string) {
  if (!notes.length) return ''
  const cards = notes.map(note => {
    const excerpt = markdownPlainText(note.body)
    const shortened = excerpt.length > 240 ? `${excerpt.slice(0, 237).trimEnd()}…` : excerpt
    const url = new URL(`/post/${note.id}`, origin).href
    const replyPreviews = note.replies?.length
      ? `<div style="margin:12px 0 0 12px;padding-left:11px;border-left:1px solid #d9dbd4">${note.replies.map(reply => {
        const text = markdownPlainText(reply.body)
        const shortenedReply = text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text
        return `<div style="padding:7px 0;border-top:1px solid #e4e6df;color:#60665e;font-size:11px;line-height:1.5"><span style="color:#55734a;font-weight:700">@${
          escapeHtml(reply.handle)
        }</span> ${escapeHtml(shortenedReply)}</div>`
      }).join('')}</div>`
      : ''
    return `<tr><td style="padding:0 0 12px">
      <a href="${
      escapeHtml(url)
      }" class="note-card" style="display:block;padding:14px 2px;color:#20231f;background:transparent;border:0;border-top:1px solid #d9dbd4;text-decoration:none">
        <div style="padding:0 0 9px;color:#55734a;font-size:11px;font-weight:700">@${escapeHtml(note.handle)}</div>
        <div style="font-size:13px;line-height:1.65">${escapeHtml(shortened)}</div>
        ${replyPreviews}
      </a>
    </td></tr>`
  }).join('')
  return `<tr><td class="email-pad" style="padding:26px 30px 8px">
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
<meta name="color-scheme" content="light"><title>A lot has happened · ${escapeHtml(name)}</title>${responsiveEmailStyles}</head>
<body style="margin:0;padding:0;background:#e9eee6;color:#20231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">A launch recap: better writing, discovery, conversations, notifications, feeds, and more.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e9eee6"><tr><td class="email-outer" align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace">
  <tr><td class="email-brand" align="center" style="padding:0 0 14px">
    <a href="${escapeHtml(origin)}" style="display:inline-block;color:#20231f;text-decoration:none">
      <img src="${
    escapeHtml(logoUrl)
  }" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:5px;border:0;vertical-align:-6px"><span style="font-size:18px;font-weight:800;letter-spacing:-1px">${
    escapeHtml(name)
  }</span>
    </a>
  </td></tr>
  <tr><td class="email-panel" bgcolor="#f1f5ee" style="border:1px solid #d9dbd4">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="email-pad email-hero" style="padding:34px 30px 30px;border-bottom:1px solid #d9dbd4">
        <div style="margin-bottom:10px;color:#749668;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Since launch</div>
        <h1 class="email-heading" style="margin:0 0 14px;color:#55734a;font-size:25px;line-height:1.25;letter-spacing:-1px">A lot has happened.<br>Quietly, of course.</h1>
        <p style="margin:0;color:#3f443d;font-size:13px;line-height:1.7">We started with a simple place to write. Since then, ${
    escapeHtml(name)
  } has become more expressive, more personal, and easier to carry with you—without getting any louder.</p>
      </td></tr>
      <tr><td class="email-pad" style="padding:26px 30px 10px">
        <div style="margin-bottom:5px;color:#8a9085;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">What’s new</div>
        <h2 style="margin:0 0 17px;color:#20231f;font-size:17px;line-height:1.35">The short version</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
    featureRows(origin)
  }</table>
      </td></tr>
      ${popularNotes(notes, origin)}
      <tr><td class="email-pad" align="center" style="padding:22px 30px 32px">
        <p style="margin:0 0 16px;color:#60665e;font-size:12px;line-height:1.65">There’s more to find, and plenty more to come. Thanks for making this small corner of the internet feel alive.</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#749668">
          <a href="${
    escapeHtml(hotUrl)
  }" class="email-cta" style="display:inline-block;padding:11px 15px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border:1px solid #749668">See what’s happening →</a>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:14px 0 0;color:#8a9085;font-size:11px;line-height:1.8">
    <a href="${
    escapeHtml(unsubscribeUrl)
  }" style="color:#55734a;text-decoration:underline">Unsubscribe from recap emails</a><br>
    Sent by ${escapeHtml(name)} · <a href="${escapeHtml(origin)}" style="color:#55734a;text-decoration:none">${
    escapeHtml(new URL(origin).host)
  }</a>
  </td></tr>
</table></td></tr></table></body></html>`
}

export function recapEmailForUser(database: Database, requestOrigin: string, userId: number) {
  return recapEmail(database, requestOrigin, issueRecapUnsubscribeToken(database, userId))
}

export function recapEmailV2(database: Database, requestOrigin: string, unsubscribeToken: string) {
  const name = appName()
  const origin = Bun.env.APP_URL ? new URL(Bun.env.APP_URL).origin : new URL(requestOrigin).origin
  const logoUrl = new URL('/email-logo.png?v=1', origin).href
  const recapUrl = new URL('/blog/recap-v2', origin).href
  const unsubscribeUrl = new URL(
    `/account/recap-emails/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
    origin,
  ).href
  const notes = recapV2Notes(database)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>The story so far · ${escapeHtml(name)}</title>${responsiveEmailStyles}</head>
<body style="margin:0;padding:0;background:#e9eee6;color:#20231f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">The complete textlog recap: writing, conversations, feeds, discovery, identity, and the wider web.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e9eee6"><tr><td class="email-outer" align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace">
  <tr><td class="email-brand" align="center" style="padding:0 0 14px"><a href="${escapeHtml(origin)}" style="display:inline-block;color:#20231f;text-decoration:none">
    <img src="${escapeHtml(logoUrl)}" width="24" height="24" alt="" style="display:inline-block;width:24px;height:24px;margin-right:5px;border:0;vertical-align:-6px"><span style="font-size:18px;font-weight:800;letter-spacing:-1px">${escapeHtml(name)}</span>
  </a></td></tr>
  <tr><td class="email-panel" bgcolor="#f1f5ee" style="border:1px solid #d9dbd4"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td class="email-pad email-hero" style="padding:34px 30px 30px;border-bottom:1px solid #d9dbd4">
      <div style="margin-bottom:10px;color:#749668;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">The story so far</div>
      <h1 class="email-heading" style="margin:0 0 14px;color:#55734a;font-size:25px;line-height:1.25;letter-spacing:-1px">More ways to connect.<br>Still quietly.</h1>
      <p style="margin:0;color:#3f443d;font-size:13px;line-height:1.7">${escapeHtml(name)} began as a small place for short notes. It has grown into a richer social space without losing the simplicity that made it feel different.</p>
    </td></tr>
    <tr><td class="email-pad" style="padding:26px 30px 10px">
      <div style="margin-bottom:5px;color:#8a9085;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">The complete recap</div>
      <h2 style="margin:0 0 17px;color:#20231f;font-size:17px;line-height:1.35">What textlog has become</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${featureRowsV2(origin)}</table>
    </td></tr>
    ${popularNotes(notes, origin).replace('Notes we kept thinking about', 'The conversations that grew')}
    <tr><td class="email-pad" align="center" style="padding:22px 30px 32px">
      <p style="margin:0 0 16px;color:#60665e;font-size:12px;line-height:1.65">Every feature began with people writing, replying, and making this quiet corner of the web their own.</p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#749668">
        <a href="${escapeHtml(recapUrl)}" class="email-cta" style="display:inline-block;padding:11px 15px;color:#ffffff;font-size:12px;font-weight:700;text-decoration:none;border:1px solid #749668">Read the complete recap →</a>
      </td></tr></table>
    </td></tr>
  </table></td></tr>
  <tr><td align="center" style="padding:14px 0 0;color:#8a9085;font-size:11px;line-height:1.8">
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#55734a;text-decoration:underline">Unsubscribe from recap emails</a><br>
    Sent by ${escapeHtml(name)} · <a href="${escapeHtml(origin)}" style="color:#55734a;text-decoration:none">${escapeHtml(new URL(origin).host)}</a>
  </td></tr>
</table></td></tr></table></body></html>`
}

export function recapEmailV2ForUser(database: Database, requestOrigin: string, userId: number) {
  return recapEmailV2(database, requestOrigin, issueRecapUnsubscribeToken(database, userId))
}
