import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import { decodeHtmlEntities } from './link-preview'
import { displayPostBody } from './utils'

marked.use({
  extensions: [{
    name: 'slashItalics',
    level: 'inline',
    start(src) {
      const match = /(?:^|\s)\/[^\/\s]/.exec(src)
      return match ? match.index + (match[0].startsWith('/') ? 0 : 1) : undefined
    },
    tokenizer(src) {
      const match = /^\/([^\/\s](?:[^\/\r\n]*?[^\/\s])?)\/(?!\/)/.exec(src)
      if (!match) return
      return { type: 'slashItalics', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) }
    },
    renderer(token) {
      return `<em>${this.parser.parseInline(token.tokens!)}</em>`
    },
    childTokens: ['tokens'],
  }],
})

hljs.registerLanguage('typescript', typescript)

function xml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function html(value: string) {
  return xml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function sanitizedMarkdownHtml(body: string, options: { highlightCode?: boolean } = {}) {
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
  renderer.em = token =>
    token.raw.startsWith('_')
      ? `<u>${renderer.parser.parseInline(token.tokens)}</u>`
      : `<strong>${renderer.parser.parseInline(token.tokens)}</strong>`
  renderer.strong = token =>
    token.raw.startsWith('__')
      ? `<u>${renderer.parser.parseInline(token.tokens)}</u>`
      : `<strong>${renderer.parser.parseInline(token.tokens)}</strong>`
  if (options.highlightCode) {
    renderer.code = ({ text, lang }) => {
      const language = lang === 'ts' ? 'typescript' : lang
      const highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value
      return `<pre><code class="hljs">${highlighted}</code></pre>`
    }
  }
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
      ...(options.highlightCode ? ['span'] : []),
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
    ],
    allowedAttributes: options.highlightCode
      ? { a: ['href', 'title'], code: ['class'], span: ['class'] }
      : { a: ['href', 'title'] },
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
