import { AnsiUp } from 'ansi_up'
import { httpLogPath, httpLogUsername } from './logs-path'

const output = typeof document === 'undefined' ? null : document.querySelector<HTMLPreElement>('#logs-output')

function linkText(entry: HTMLElement, text: string, href: string, className: string) {
  const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const start = node.data.indexOf(text)
    if (start === -1) continue
    const link = document.createElement('a')
    link.className = className
    link.href = href
    link.textContent = text
    if (className === 'log-username' && node.parentElement) node.parentElement.classList.add('log-username-ansi')
    node.replaceWith(node.data.slice(0, start), link, node.data.slice(start + text.length))
    return
  }
}

function linkHttpFields(entry: HTMLElement, value: string) {
  const username = httpLogUsername(value)
  if (username) linkText(entry, `@${username}`, `/u/${encodeURIComponent(username)}`, 'log-username')
  const path = httpLogPath(value)
  if (path) linkText(entry, path, path, 'log-path')
}

if (output) {
  const converter = new AnsiUp()
  converter.escape_html = true
  converter.faintStyle = 'opacity:0.45'
  // Keep ordinary gray visibly separate from bright white.
  const palette = converter as unknown as {
    ansi_colors: Array<Array<{ rgb: [number, number, number] }>>
  }
  palette.ansi_colors[0][4].rgb = [108, 182, 255]
  palette.ansi_colors[0][7].rgb = [98, 104, 114]
  palette.ansi_colors[1][0].rgb = [65, 71, 80]
  const entries: HTMLElement[] = []
  const events = new EventSource('/admin/logs/events')

  events.onmessage = event => {
    const value = JSON.parse(event.data) as string
    const entry = document.createElement('span')
    entry.className = 'log-entry'
    entry.innerHTML = converter.ansi_to_html(value)
    linkHttpFields(entry, value)
    output.append(entry)
    entries.push(entry)
    while (entries.length > 1_000) entries.shift()?.remove()
    output.scrollTop = output.scrollHeight
  }
}
