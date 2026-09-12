type FeedTemplateMatch = 'label' | 'anchor'

export function templateMaterializedFeedHtml(html: string, match: FeedTemplateMatch) {
  const token = (source: string, path: string, label: string, name: string) => {
    if (match === 'label') {
      return source.replace(
        new RegExp(`(<a[^>]*href="${path}"[^>]*>${label})(?:<span class="to-me-count">\\d+\\+?</span>)?(</a>)`),
        `$1{{${name}-count}}$2`,
      )
    }
    return source.replace(
      new RegExp(`<a[^>]*href="${path}"[^>]*>(?:(?!</a>)[\\s\\S])*</a>`),
      anchor => anchor.includes(label)
        ? anchor.replace(/(?:<span class="to-me-count">\d+\+?<\/span>)?<\/a>$/, `{{${name}-count}}</a>`)
        : anchor,
    )
  }
  const accountTokens = html.replace(
    /(<form\b[^>]*action="\/account\/accounts\/select"[^>]*>[\s\S]*?<input\b[^>]*name="accountId"\s+value="(\d+)"[^>]*>[\s\S]*?<button\b[^>]*class="account-menu-account"[^>]*>)(?:<span class="unread-dot"\s+aria-label="unread activity"><\/span>)?/g,
    (_match, prefix: string, accountId: string) => `${prefix}{{account-${accountId}-unread}}`,
  ).replace(
    /(<(?:summary|a)\b[^>]*class="account-menu-handle"[^>]*>)(?:\s*<span class="unread-dot"\s+aria-label="unread account activity"><\/span>)?/,
    '$1{{linked-account-unread}}',
  )
  return token(token(token(token(accountTokens, '\/my-feed', 'my feed', 'for-you'), '\/@', '@', 'to-me'),
    '\/new', 'new', 'new'), '\/all', 'all', 'latest')
    .replace(
      /<a href="\/drafts(?:\?[^\"]*)?">drafts<\/a>|(?=<\/span>\s*<span class="account-nav-row account-nav-primary">)/,
      '{{drafts-link}}',
    )
}
