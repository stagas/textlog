import { AnsiUp } from 'ansi_up'

const output = document.querySelector<HTMLPreElement>('#logs-output')

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
    const entry = document.createElement('span')
    entry.className = 'log-entry'
    entry.innerHTML = converter.ansi_to_html(JSON.parse(event.data))
    output.append(entry)
    entries.push(entry)
    while (entries.length > 1_000) entries.shift()?.remove()
    output.scrollTop = output.scrollHeight
  }
}
