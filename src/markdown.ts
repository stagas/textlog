import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { decodeHtmlEntities } from './link-preview'
import { displayPostBody } from './utils'

function xml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function html(value: string) {
  return xml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function sanitizedMarkdownHtml(body: string) {
  const renderer = new marked.Renderer()
  renderer.html = ({ text }) =>
    /^<\/?(?:a|abbr|address|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)(?:\s|\/?>)/i
        .test(text)
      ? text
      : xml(text)
  // Posts do not embed remote images. Keep Markdown image syntax useful in
  // feeds by rendering its alt text as a link instead of sanitizing it away.
  renderer.image = ({ href, title, text }) =>
    `<a href="${html(href)}"${title ? ` title="${html(title)}"` : ''}>${html(text || href)}</a>`
  renderer.em = token => token.raw.startsWith('_')
    ? `<u>${renderer.parser.parseInline(token.tokens)}</u>`
    : `<strong>${renderer.parser.parseInline(token.tokens)}</strong>`
  renderer.strong = token => token.raw.startsWith('__')
    ? `<u>${renderer.parser.parseInline(token.tokens)}</u>`
    : `<strong>${renderer.parser.parseInline(token.tokens)}</strong>`
  const rendered = marked.parse(displayPostBody(body), { async: false, breaks: true, gfm: true, renderer })
  return sanitizeHtml(rendered, {
    allowedTags: [
      'a',
      'blockquote',
      'br',
      'code',
      'del',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'li',
      'ol',
      'p',
      'pre',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  }).trim()
}

export function markdownPlainText(body: string) {
  const spacedHtml = sanitizedMarkdownHtml(body)
    .replace(/<\/?(?:blockquote|br|h[1-6]|hr|li|ol|p|pre|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi, ' ')
  return decodeHtmlEntities(sanitizeHtml(spacedHtml, {
    allowedTags: [],
    allowedAttributes: {},
  })).replace(/\s+/g, ' ').trim()
}
