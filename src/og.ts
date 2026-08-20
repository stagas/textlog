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
const textColor = '#f0f3ee'
const accentColor = '#9abd8e'
const codeColor = '#a8afa4'
const headerWordmarkOffsetY = 8
const defaultWordmarkOffsetY = 10
const mathPlaceholder = '\uFFFC'
const mathImageCache = new Map<string, Image>()

type OgRange = { start: number; end: number }
type OgMath = OgRange & { source: string; display: boolean }

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

function linesFor(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const sourceLine of text.replace(/\r/g, '').split('\n')) {
    let remaining = sourceLine.replace(/\t/g, '    ')
    if (!remaining) {
      lines.push('')
      continue
    }

    while (ctx.measureText(remaining).width > maxWidth) {
      let cut = 1
      while (cut < remaining.length && ctx.measureText(remaining.slice(0, cut + 1)).width <= maxWidth) cut++

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

function fitPost(ctx: CanvasRenderingContext2D, body: string, availableHeight = maxTextHeight, maxSize = 108) {
  // Let the longest authored line influence the starting size. This favors fewer,
  // longer rows instead of rendering large type and wrapping after only a few words.
  const longestSourceLine = body.replace(/\r/g, '').split('\n')
    .map(line => line.replace(/\t/g, '    '))
    .reduce((longest, line) => line.length > longest.length ? line : longest, '')
  ctx.font = `500 ${maxSize}px monospace`
  const longestWidth = ctx.measureText(longestSourceLine).width
  const widthFittedSize = longestWidth ? Math.floor(maxSize * maxTextWidth / longestWidth) : maxSize
  const startingSize = Math.max(20, Math.min(maxSize, widthFittedSize))

  // Wrapping is recalculated at every size because it also affects total height.
  for (let size = startingSize; size >= 20; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    const lines = linesFor(ctx, body, maxTextWidth)
    const lineHeight = Math.round(size * 1.32)
    if (lines.length * lineHeight <= availableHeight) return { lines, lineHeight, size }
  }
  const size = 20
  const lineHeight = 26
  ctx.font = `500 ${size}px monospace`
  const lines = linesFor(ctx, body, maxTextWidth)
  const visibleLineCount = Math.max(1, Math.floor(availableHeight / lineHeight))
  const visibleLines = lines.slice(0, visibleLineCount)
  if (lines.length > visibleLineCount) {
    const last = visibleLines.length - 1
    visibleLines[last] = visibleLines[last].replace(/\s+$/, '') + '…'
  }
  return { lines: visibleLines, lineHeight, size }
}

export function postOgText(body: string) {
  body = splitSpoilerBody(body).visible
  const links: OgRange[] = []
  const code: OgRange[] = []
  const math: OgMath[] = []
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
  return { text, links, code, math }
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 3) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#9abd8e'
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
) {
  let drawX = x
  const styles = Array.from({ length: line.length }, (_, index) => {
    const position = lineStart + index
    if (links.some(link => position >= link.start && position < link.end)) return 'link'
    if (code.some(range => position >= range.start && position < range.end)) return 'code'
    if (math.some(range => position >= range.start && position < range.end)) return 'math'
    return 'text'
  })

  const draw = (text: string, style: 'text' | 'link' | 'code' | 'math') => {
    if (!text) return
    ctx.fillStyle = style === 'link' ? accentColor : style === 'code' ? codeColor : textColor
    ctx.fillText(text, drawX, y)
    const metrics = ctx.measureText(text)
    const nextX = drawX + metrics.width
    if (style === 'link') {
      const fontSize = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 20)
      const textTop = y - ctx.measureText('M').actualBoundingBoxAscent
      const underlineY = textTop + fontSize * 1.05
      ctx.strokeStyle = accentColor
      ctx.lineWidth = Math.max(1, fontSize * 0.025)
      ctx.beginPath()
      ctx.moveTo(drawX, underlineY)
      ctx.lineTo(nextX, underlineY)
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
    const style = styles[cursor]
    let next = cursor + 1
    while (next < line.length && styles[next] === style) next++
    draw(line.slice(cursor, next), style)
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
    drawLinkedLine(ctx, line, 80, y, lineStart < 0 ? searchFrom : lineStart, post.links, post.code, post.math)
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

export function renderProfileOg(
  handle: string,
  bio: string,
  counts: { notes: number; following: number; followingTags: number; followers: number },
) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  drawBackground(ctx)

  let handleSize = 76
  ctx.font = `700 ${handleSize}px monospace`
  while (ctx.measureText(`@${handle}`).width > maxTextWidth && handleSize > 48) {
    handleSize -= 2
    ctx.font = `700 ${handleSize}px monospace`
  }
  ctx.fillStyle = accentColor
  ctx.fillText('@', 80, 245)
  const prefixWidth = ctx.measureText('@').width
  ctx.fillStyle = textColor
  ctx.fillText(handle, 80 + prefixWidth, 245)

  const profileBio = postOgText(bio.trimEnd() || 'No bio yet.')
  let size = 46
  let lines: string[] = []
  let lineHeight = 61
  for (; size >= 28; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    lines = linesFor(ctx, profileBio.text, maxTextWidth)
    lineHeight = Math.round(size * 1.35)
    if (lines.length * lineHeight <= 165) break
  }
  size = Math.max(size, 28)
  const visibleLineCount = Math.floor(165 / lineHeight)
  if (lines.length > visibleLineCount) {
    lines = lines.slice(0, visibleLineCount)
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+$/, '') + '…'
  }

  ctx.fillStyle = textColor
  ctx.font = `500 ${size}px monospace`
  let y = 340
  let searchFrom = 0
  for (const line of lines) {
    const lineStart = profileBio.text.indexOf(line, searchFrom)
    drawLinkedLine(ctx, line, 80, y, lineStart < 0 ? searchFrom : lineStart, profileBio.links, profileBio.code,
      profileBio.math)
    searchFrom = (lineStart < 0 ? searchFrom : lineStart) + line.length
    y += lineHeight
  }

  const stats = [
    [
      { text: String(counts.notes), accent: true },
      { text: ` ${counts.notes === 1 ? 'note' : 'notes'}` },
    ],
    [
      { text: String(counts.followingTags), accent: true },
      { text: ` ${counts.followingTags === 1 ? 'tag' : 'tags'}, ` },
      { text: String(counts.following), accent: true },
      { text: ` ${counts.following === 1 ? 'user' : 'users'} following` },
    ],
    [
      { text: String(counts.followers), accent: true },
      { text: ` ${counts.followers === 1 ? 'follower' : 'followers'}` },
    ],
  ]
  let statsSize = 30
  ctx.font = `500 ${statsSize}px monospace`
  const statsText = stats.map(stat => stat.map(part => part.text).join('')).join('  ·  ')
  while (ctx.measureText(statsText).width > maxTextWidth && statsSize > 20) {
    statsSize -= 2
    ctx.font = `500 ${statsSize}px monospace`
  }
  ctx.fillStyle = textColor
  let statsX = 80
  for (const [index, stat] of stats.entries()) {
    if (index > 0) {
      ctx.fillStyle = accentColor
      ctx.fillText('·', statsX, 565)
      statsX += ctx.measureText('·  ').width
    }
    for (const part of stat) {
      ctx.fillStyle = part.accent ? accentColor : textColor
      ctx.fillText(part.text, statsX, 565)
      statsX += ctx.measureText(part.text).width
    }
    statsX += ctx.measureText('  ').width
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
