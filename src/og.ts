import { type CanvasRenderingContext2D, createCanvas, Image } from 'canvas'
import { appName } from './brand'
import { splitSpoilerBody } from './content'
import { texToSvg } from './math'
import { parsePoll, pollDisplayBody } from './polls'
import { linkTokens } from './utils'

const width = 1200
const height = 630
const maxTextWidth = 1040
const contentTop = 140
const contentBottom = 510
const maxTextHeight = contentBottom - contentTop
const postMaxCharactersPerLine = 34
const postMaxLines = 5
const postMinFontSize = 52
const textColor = '#f0f3ee'
const accentColor = '#9abd8e'
const codeColor = '#a8afa4'
const quoteBorderColor = '#68716a'
const quoteTextColor = '#aeb6ad'
const headerWordmarkOffsetY = 8
const defaultWordmarkOffsetY = 10
const mathPlaceholder = '\uFFFC'
const mathImageCache = new Map<string, Image>()

type OgRange = { start: number; end: number }
type OgMath = OgRange & { source: string; display: boolean }
type OgTextStyle = 'bold' | 'italics' | 'underline' | 'strikethrough' | 'redacted' | 'quote'
type OgStyles = Record<OgTextStyle, OgRange[]>

function mathImage(svg: string, width: number, height: number) {
  const key = `${width}x${height}\0${svg}`
  const cached = mathImageCache.get(key)
  if (cached) return cached
  const image = new Image()
  image.src = Buffer.from(svg
    .replace(/width="[^"]+"/, `width="${width}px"`)
    .replace(/height="[^"]+"/, `height="${height}px"`)
    .replaceAll('currentColor', textColor))
  if (mathImageCache.size >= 256) mathImageCache.delete(mathImageCache.keys().next().value!)
  mathImageCache.set(key, image)
  return image
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const brand = appName()
  ctx.fillStyle = '#111512'
  ctx.fillRect(0, 0, width, height)
  drawLogo(ctx, 70, 45)

  ctx.fillStyle = textColor
  ctx.font = '700 62px monospace'
  const brandX = 158
  const brandBaseline = 94 + headerWordmarkOffsetY
  ctx.fillText(brand, brandX, brandBaseline)
}

function linesFor(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxCharacters = Infinity) {
  const lines: string[] = []
  for (const sourceLine of text.replace(/\r/g, '').split('\n')) {
    let remaining = sourceLine.replace(/\t/g, '    ')
    if (!remaining) {
      lines.push('')
      continue
    }

    while (remaining.length > maxCharacters || ctx.measureText(remaining).width > maxWidth) {
      let cut = 1
      while (cut < remaining.length && cut < maxCharacters
        && ctx.measureText(remaining.slice(0, cut + 1)).width <= maxWidth) cut++

      // Prefer a natural wrap point for prose. Only the single separator introduced
      // by wrapping is omitted; indentation and all explicit line breaks stay intact.
      const naturalBreak = remaining.slice(0, cut).lastIndexOf(' ')
      if (naturalBreak > 0) {
        lines.push(remaining.slice(0, naturalBreak))
        remaining = remaining.slice(naturalBreak + 1)
      }
      else {
        lines.push(remaining.slice(0, cut))
        remaining = remaining.slice(cut)
      }
    }
    lines.push(remaining)
  }
  return lines
}

export function fitPost(ctx: CanvasRenderingContext2D, body: string, availableHeight = maxTextHeight, maxSize = 108) {
  // Preserve large type for short posts, but never shrink a long post into fine print.
  // Long content is clamped below instead of being allowed to dictate the font size.
  const minSize = Math.min(postMinFontSize, maxSize)
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    const lines = linesFor(ctx, body, maxTextWidth, postMaxCharactersPerLine)
    const lineHeight = Math.round(size * 1.32)
    if (lines.length <= postMaxLines && lines.length * lineHeight <= availableHeight) {
      return { lines, lineHeight, size }
    }
  }
  const size = minSize
  const lineHeight = Math.round(size * 1.32)
  ctx.font = `500 ${size}px monospace`
  const lines = linesFor(ctx, body, maxTextWidth, postMaxCharactersPerLine)
  const visibleLineCount = Math.max(1, Math.min(postMaxLines, Math.floor(availableHeight / lineHeight)))
  const visibleLines = lines.slice(0, visibleLineCount)
  if (lines.length > visibleLineCount) {
    const last = visibleLines.length - 1
    let truncated = visibleLines[last].replace(/\s+$/, '')
    while (truncated && (truncated.length + 1 > postMaxCharactersPerLine
      || ctx.measureText(`${truncated}…`).width > maxTextWidth)) truncated = truncated.slice(0, -1).replace(/\s+$/, '')
    visibleLines[last] = `${truncated}…`
  }
  return { lines: visibleLines, lineHeight, size }
}

export function postOgText(body: string) {
  body = splitSpoilerBody(body).visible
  const links: OgRange[] = []
  const code: OgRange[] = []
  const math: OgMath[] = []
  const styles: OgStyles = {
    bold: [], italics: [], underline: [], strikethrough: [], redacted: [], quote: [],
  }
  const quotedLines: boolean[] = []
  let unquotedBody = ''
  for (const [index, line] of body.replace(/\r/g, '').split('\n').entries()) {
    if (index) unquotedBody += '\n'
    const quote = line.match(/^>\s?/)
    quotedLines.push(Boolean(quote))
    unquotedBody += quote ? line.slice(quote[0].length) : line
  }
  body = unquotedBody
  let text = ''
  let sourceEnd = 0
  for (const token of linkTokens(body)) {
    if (token.index < sourceEnd) continue
    text += body.slice(sourceEnd, token.index)
    const start = text.length
    if (token.kind === 'math' || token.kind === 'latex-fence') {
      const display = token.kind === 'latex-fence' || token.display!
      const rendered = texToSvg(token.label!, display)
      if (!rendered) text += token.raw
      else {
        if (display && text && !text.endsWith('\n')) text += '\n'
        const start = text.length
        const placeholderCount = Math.max(1, Math.ceil(rendered.width / 600))
        text += mathPlaceholder.repeat(placeholderCount)
        math.push({ start, end: text.length, source: token.label!, display })
        if (display && body[token.lastIndex] && body[token.lastIndex] !== '\n') text += '\n'
      }
    }
    else if (token.kind === 'code' || token.kind === 'code-fence') {
      text += token.label!
      code.push({ start, end: text.length })
    }
    else if (token.kind === 'bold' || token.kind === 'italics' || token.kind === 'underline'
      || token.kind === 'strikethrough' || token.kind === 'redacted') {
      text += token.label!
      styles[token.kind].push({ start, end: text.length })
    }
    else if (token.kind === 'markdown') {
      text += token.label!
      links.push({ start, end: text.length })
    }
    else {
      text += token.raw
      if (token.kind === 'url' || token.kind === 'reference') links.push({ start, end: text.length })
    }
    sourceEnd = token.lastIndex
  }
  text += body.slice(sourceEnd)
  let renderedLineStart = 0
  for (const [index, line] of text.split('\n').entries()) {
    if (quotedLines[index]) styles.quote.push({ start: renderedLineStart, end: renderedLineStart + line.length })
    renderedLineStart += line.length + 1
  }
  return { text, links, code, math, styles }
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 3, color = accentColor) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.rect(13, 16, 8, 3)
  ctx.moveTo(8.5, 13)
  ctx.lineTo(2.47, 7)
  ctx.lineTo(6.71, 7)
  ctx.lineTo(11.67, 11.95)
  ctx.bezierCurveTo(12.25, 12.54, 12.25, 13.5, 11.67, 14.07)
  ctx.lineTo(6.74, 19)
  ctx.lineTo(2.5, 19)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export type FollowBadgeTheme = 'light' | 'dark' | 'sepia' | 'dracula'

const followBadgePalettes: Record<FollowBadgeTheme, { background: string; foreground: string; accent: string }> = {
  light: { background: '#f4f3ee', foreground: '#20231f', accent: '#749668' },
  dark: { background: '#171a17', foreground: '#e5e8e1', accent: '#9abd8e' },
  sepia: { background: '#f4ecd8', foreground: '#433422', accent: '#8a6d3b' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', accent: '#bd93f9' },
}

export function renderFollowBadge(handle: string, theme: FollowBadgeTheme = 'dark') {
  const palette = followBadgePalettes[theme]
  const brand = appName()
  const pixelRatio = 1
  const height = 64
  const fontSize = 28
  const canvas = createCanvas(1, height * pixelRatio)
  const measure = canvas.getContext('2d')
  measure.font = `400 ${fontSize}px monospace`
  const regularPrefixWidth = measure.measureText('follow ').width + measure.measureText(' on').width
  const markScale = 1.55
  const markWidth = (21 - 2.47) * markScale
  measure.font = `700 ${fontSize}px monospace`
  const handleWidth = measure.measureText(`@${handle}`).width
  const brandWidth = measure.measureText(brand).width
  const width = Math.ceil(18 + regularPrefixWidth + handleWidth + 16 + markWidth + 9 + brandWidth + 18)
  canvas.width = width * pixelRatio
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)

  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, width, height)

  ctx.font = `400 ${fontSize}px monospace`
  ctx.textBaseline = 'middle'
  let x = 18
  const baseline = height / 2 + 1
  ctx.fillStyle = palette.foreground
  ctx.fillText('follow ', x, baseline)
  x += ctx.measureText('follow ').width
  ctx.font = `700 ${fontSize}px monospace`
  ctx.fillStyle = palette.accent
  ctx.fillText(`@${handle}`, x, baseline)
  x += ctx.measureText(`@${handle}`).width
  ctx.font = `400 ${fontSize}px monospace`
  ctx.fillStyle = palette.foreground
  ctx.fillText(' on', x, baseline)
  x += ctx.measureText(' on').width + 16

  // Keep the mark and wordmark together as the brand lockup. drawLogo's
  // visible path occupies x=2.47..21 and y=7..19 within its local space.
  drawLogo(ctx, x - 2.47 * markScale, height / 2 - 13 * markScale + 1, markScale, palette.accent)
  x += markWidth + 9
  ctx.fillStyle = palette.foreground
  ctx.font = `700 ${fontSize}px monospace`
  ctx.fillText(brand, x, baseline)

  return canvas.toBuffer('image/png')
}

export function renderDefaultOg() {
  const brand = appName()
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111512'
  ctx.fillRect(0, 0, width, height)

  const scale = 6
  const markWidth = (23 - 2.47) * scale
  const gap = 38
  ctx.font = '700 125px monospace'
  const brandWidth = ctx.measureText(brand).width
  const lockupWidth = markWidth + gap + brandWidth
  const left = (width - lockupWidth) / 2
  const markTop = height / 2 - (7 + 16.6) * scale / 2
  drawLogo(ctx, left - 2.47 * scale, markTop, scale)

  const textX = left + markWidth + gap
  const metrics = ctx.measureText(brand)
  const baseline = height / 2
    + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
    + defaultWordmarkOffsetY
  ctx.fillStyle = textColor
  ctx.fillText(brand, textX, baseline)

  return canvas.toBuffer('image/png')
}

function drawLinkedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  lineStart: number,
  links: Array<{ start: number; end: number }>,
  code: Array<{ start: number; end: number }>,
  math: OgMath[],
  styles: OgStyles,
) {
  let drawX = x
  const characterStyles = Array.from({ length: line.length }, (_, index) => {
    const position = lineStart + index
    const base = links.some(link => position >= link.start && position < link.end) ? 'link'
      : code.some(range => position >= range.start && position < range.end) ? 'code'
      : math.some(range => position >= range.start && position < range.end) ? 'math' : 'text'
    const modifiers = (Object.keys(styles) as OgTextStyle[])
      .filter(name => styles[name].some(range => position >= range.start && position < range.end))
    return `${base}:${modifiers.join(',')}`
  })

  const draw = (text: string, style: 'text' | 'link' | 'code' | 'math', start: number) => {
    if (!text) return
    const active = (Object.keys(styles) as OgTextStyle[])
      .filter(name => styles[name].some(range => start >= range.start && start < range.end))
    const fontSize = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 20)
    const weight = active.includes('bold') ? 800 : style === 'code' ? 600 : 500
    const slant = active.includes('italics') ? 'italic ' : ''
    ctx.font = `${slant}${weight} ${fontSize}px monospace`
    ctx.fillStyle = style === 'link' ? accentColor : style === 'code' ? codeColor
      : active.includes('quote') ? quoteTextColor : textColor
    const metrics = ctx.measureText(text)
    const nextX = drawX + metrics.width
    if (active.includes('redacted')) {
      ctx.fillStyle = codeColor
      ctx.fillRect(drawX, y - metrics.actualBoundingBoxAscent, metrics.width,
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent)
    }
    else ctx.fillText(text, drawX, y)
    if (style === 'link') {
      const textTop = y - ctx.measureText('M').actualBoundingBoxAscent
      const underlineY = textTop + fontSize * 1.05
      ctx.strokeStyle = accentColor
      ctx.lineWidth = Math.max(1, fontSize * 0.025)
      ctx.beginPath()
      ctx.moveTo(drawX, underlineY)
      ctx.lineTo(nextX, underlineY)
      ctx.stroke()
    }
    if (active.includes('underline') || active.includes('strikethrough')) {
      ctx.strokeStyle = ctx.fillStyle
      ctx.lineWidth = Math.max(2, fontSize * 0.035)
      const decorationY = active.includes('strikethrough')
        ? y - metrics.actualBoundingBoxAscent * 0.38
        : y + Math.max(3, metrics.actualBoundingBoxDescent * 0.55)
      ctx.beginPath()
      ctx.moveTo(drawX, decorationY)
      ctx.lineTo(nextX, decorationY)
      ctx.stroke()
    }
    drawX = nextX
  }

  let cursor = 0
  while (cursor < line.length) {
    const equation = math.find(range => lineStart + cursor === range.start)
    if (equation) {
      const fontSize = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 20)
      const rendered = texToSvg(equation.source, equation.display)
      if (rendered) {
        const preferredMathSize = fontSize * (equation.display ? 1.15 : 1.05)
        const mathSize = Math.min(preferredMathSize, maxTextWidth * 1000 / rendered.width)
        const imageWidth = rendered.width / 1000 * mathSize
        const imageHeight = rendered.height / 1000 * mathSize
        const image = mathImage(rendered.svg, imageWidth, imageHeight)
        ctx.drawImage(image, drawX, y + rendered.minY / 1000 * mathSize, imageWidth, imageHeight)
        drawX = equation.display ? drawX : drawX + imageWidth
        cursor += equation.end - equation.start
        continue
      }
    }
    const signature = characterStyles[cursor]
    const style = signature.split(':')[0] as 'text' | 'link' | 'code' | 'math'
    let next = cursor + 1
    while (next < line.length && characterStyles[next] === signature) next++
    draw(line.slice(cursor, next), style, lineStart + cursor)
    cursor = next
  }
}

function drawPollOptions(ctx: CanvasRenderingContext2D, options: string[], fontSize: number, top: number) {
  const columns = options.length > 4 ? 2 : 1
  const rows = Math.ceil(options.length / columns)
  const gap = 10
  const columnGap = 14
  const rowHeight = (contentBottom - top - (rows - 1) * gap) / rows
  const optionWidth = columns === 2 ? (maxTextWidth - columnGap) / 2 : maxTextWidth
  ctx.font = `500 ${fontSize}px monospace`

  for (const [index, option] of options.entries()) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = 80 + column * (optionWidth + columnGap)
    const y = top + row * (rowHeight + gap)
    ctx.fillStyle = '#171d18'
    ctx.strokeStyle = '#465048'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.rect(x, y, optionWidth, rowHeight)
    ctx.fill()
    ctx.stroke()

    const label = linesFor(ctx, option, optionWidth - 40)[0] || ''
    const clipped = label === option ? label : label.replace(/\s+$/, '') + '…'
    const metrics = ctx.measureText(clipped)
    ctx.fillStyle = textColor
    ctx.fillText(clipped, x + 20,
      y + (rowHeight + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2)
  }
}

export function renderPostOg(body: string, handle: string) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  drawBackground(ctx)

  const visibleBody = splitSpoilerBody(body.trimEnd()).visible
  const poll = parsePoll(visibleBody)
  const post = postOgText(poll ? pollDisplayBody(visibleBody) : visibleBody)
  const pollRows = poll ? Math.ceil(poll.options.length / (poll.options.length > 4 ? 2 : 1)) : 0
  const pollHeight = poll ? pollRows * (poll.options.length > 4 ? 60 : 68) + (pollRows - 1) * 10 : 0
  const questionGap = 8
  const questionHeight = poll ? Math.max(26, maxTextHeight - pollHeight - questionGap) : maxTextHeight
  const pollFontSize = poll
    ? poll.options.length === 2
      ? 70
      : poll.options.length === 3
      ? 52
      : poll.options.length === 4
      ? 40
      : poll.options.length <= 6
      ? 48
      : 38
    : 108
  const fitted = fitPost(ctx, post.text, questionHeight, pollFontSize)
  ctx.font = `500 ${fitted.size}px monospace`
  const textBlockHeight = fitted.lines.length * fitted.lineHeight
  let y = poll
    ? contentTop + fitted.size
    : contentTop + Math.max(0, (questionHeight - textBlockHeight) / 2) + fitted.size
  let searchFrom = 0
  for (const line of fitted.lines) {
    const lineStart = post.text.indexOf(line, searchFrom)
    const resolvedStart = lineStart < 0 ? searchFrom : lineStart
    const quoted = post.styles.quote.some(range => resolvedStart >= range.start && resolvedStart < range.end)
    if (quoted) {
      ctx.fillStyle = quoteBorderColor
      ctx.fillRect(80, y - fitted.size, 7, fitted.lineHeight)
    }
    drawLinkedLine(ctx, line, quoted ? 110 : 80, y, resolvedStart, post.links, post.code, post.math, post.styles)
    searchFrom = (lineStart < 0 ? searchFrom : lineStart) + line.length
    y += fitted.lineHeight
  }

  if (poll) drawPollOptions(ctx, poll.options, fitted.size, contentTop + textBlockHeight + questionGap)

  ctx.fillStyle = accentColor
  ctx.font = '500 42px monospace'
  const attribution = `@${handle}`
  ctx.fillText(attribution, width - 80 - ctx.measureText(attribution).width, 572)

  return canvas.toBuffer('image/png')
}

export function renderProfileOg(handle: string, bio: string) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  drawBackground(ctx)

  let handleSize = 76
  ctx.font = `700 ${handleSize}px monospace`
  while (ctx.measureText(`@${handle}`).width > maxTextWidth && handleSize > 48) {
    handleSize -= 2
    ctx.font = `700 ${handleSize}px monospace`
  }
  const handleText = `@${handle}`
  const handleWidth = ctx.measureText(handleText).width

  const profileBio = postOgText(bio.trimEnd() || 'No bio yet.')
  let size = 46
  let lines: string[] = []
  let lineHeight = 61
  for (; size >= 28; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    lines = linesFor(ctx, profileBio.text, maxTextWidth)
    lineHeight = Math.round(size * 1.35)
    if (lines.length * lineHeight <= 220) break
  }
  size = Math.max(size, 28)
  const visibleLineCount = Math.floor(220 / lineHeight)
  if (lines.length > visibleLineCount) {
    lines = lines.slice(0, visibleLineCount)
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+$/, '') + '…'
  }

  const gap = 48
  const blockHeight = handleSize + gap + lines.length * lineHeight
  const blockTop = 155 + (height - 155 - blockHeight) / 2 - 36
  const handleBaseline = blockTop + handleSize

  ctx.font = `500 ${size}px monospace`
  const blockWidth = Math.max(handleWidth, ...lines.map(line => ctx.measureText(line).width))
  const blockX = (width - blockWidth) / 2

  ctx.font = `700 ${handleSize}px monospace`
  ctx.fillStyle = accentColor
  ctx.fillText('@', blockX, handleBaseline)
  const prefixWidth = ctx.measureText('@').width
  ctx.fillStyle = textColor
  ctx.fillText(handle, blockX + prefixWidth, handleBaseline)

  ctx.fillStyle = textColor
  ctx.font = `500 ${size}px monospace`
  let y = handleBaseline + gap + size
  let searchFrom = 0
  for (const line of lines) {
    const lineStart = profileBio.text.indexOf(line, searchFrom)
    drawLinkedLine(ctx, line, blockX, y, lineStart < 0 ? searchFrom : lineStart, profileBio.links, profileBio.code,
      profileBio.math, profileBio.styles)
    searchFrom = (lineStart < 0 ? searchFrom : lineStart) + line.length
    y += lineHeight
  }

  return canvas.toBuffer('image/png')
}

export function renderTagOg(tag: string, notes: number) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  drawBackground(ctx)

  let tagSize = 96
  ctx.font = `700 ${tagSize}px monospace`
  while (ctx.measureText(`#${tag}`).width > maxTextWidth && tagSize > 42) {
    tagSize -= 2
    ctx.font = `700 ${tagSize}px monospace`
  }

  const tagText = `#${tag}`
  const tagWidth = ctx.measureText(tagText).width
  const tagX = (width - tagWidth) / 2
  ctx.fillStyle = accentColor
  ctx.fillText('#', tagX, 355)
  ctx.fillStyle = textColor
  ctx.fillText(tag, tagX + ctx.measureText('#').width, 355)

  ctx.font = '500 34px monospace'
  const value = String(notes)
  const label = notes === 1 ? 'note' : 'notes'
  const countWidth = ctx.measureText(`${value} ${label}`).width
  let countX = (width - countWidth) / 2
  ctx.fillStyle = accentColor
  ctx.fillText(value, countX, 470)
  countX += ctx.measureText(`${value} `).width
  ctx.fillStyle = textColor
  ctx.fillText(label, countX, 470)

  return canvas.toBuffer('image/png')
}
