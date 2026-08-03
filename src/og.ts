import { type CanvasRenderingContext2D, createCanvas } from 'canvas'

const width = 1200
const height = 630
const maxTextWidth = 1040
const contentTop = 140
const contentBottom = 510
const maxTextHeight = contentBottom - contentTop
const textColor = '#f0f3ee'
const accentColor = '#9abd8e'

function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#111512'
  ctx.fillRect(0, 0, width, height)
  drawLogo(ctx, 70, 45)

  ctx.fillStyle = textColor
  ctx.font = '700 62px monospace'
  const brandX = 158
  const brandBaseline = 102
  ctx.fillText('root', brandX, brandBaseline)
  const rootWidth = ctx.measureText('root').width
  ctx.fillStyle = accentColor
  ctx.fillText('.', brandX + rootWidth, brandBaseline)
  const dotWidth = ctx.measureText('.').width
  ctx.fillStyle = textColor
  ctx.fillText('mx', brandX + rootWidth + dotWidth, brandBaseline)
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

function fitPost(ctx: CanvasRenderingContext2D, body: string) {
  // Let the longest authored line influence the starting size. This favors fewer,
  // longer rows instead of rendering large type and wrapping after only a few words.
  const longestSourceLine = body.replace(/\r/g, '').split('\n')
    .map(line => line.replace(/\t/g, '    '))
    .reduce((longest, line) => line.length > longest.length ? line : longest, '')
  ctx.font = '500 108px monospace'
  const longestWidth = ctx.measureText(longestSourceLine).width
  const widthFittedSize = longestWidth ? Math.floor(108 * maxTextWidth / longestWidth) : 108
  const startingSize = Math.max(40, Math.min(108, widthFittedSize))

  // Wrapping is recalculated at every size because it also affects total height.
  for (let size = startingSize; size >= 20; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    const lines = linesFor(ctx, body, maxTextWidth)
    const lineHeight = Math.round(size * 1.32)
    if (lines.length * lineHeight <= maxTextHeight) return { lines, lineHeight, size }
  }
  const size = 20
  const lineHeight = 26
  ctx.font = `500 ${size}px monospace`
  const lines = linesFor(ctx, body, maxTextWidth)
  const visibleLineCount = Math.floor(maxTextHeight / lineHeight)
  const visibleLines = lines.slice(0, visibleLineCount)
  if (lines.length > visibleLineCount) {
    const last = visibleLines.length - 1
    visibleLines[last] = visibleLines[last].replace(/\s+$/, '') + '…'
  }
  return { lines: visibleLines, lineHeight, size }
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
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111512'
  ctx.fillRect(0, 0, width, height)

  const scale = 6
  const markWidth = (21 - 2.47) * scale
  const gap = 38
  ctx.font = '700 100px monospace'
  const rootWidth = ctx.measureText('root').width
  const dotWidth = ctx.measureText('.').width
  const mxWidth = ctx.measureText('mx').width
  const lockupWidth = markWidth + gap + rootWidth + dotWidth + mxWidth
  const left = (width - lockupWidth) / 2
  const markTop = height / 2 - (7 + 19) * scale / 2
  drawLogo(ctx, left - 2.47 * scale, markTop, scale)

  const textX = left + markWidth + gap
  const metrics = ctx.measureText('root.mx')
  const baseline = height / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  ctx.fillStyle = textColor
  ctx.fillText('root', textX, baseline)
  ctx.fillStyle = accentColor
  ctx.fillText('.', textX + rootWidth, baseline)
  ctx.fillStyle = textColor
  ctx.fillText('mx', textX + rootWidth + dotWidth, baseline)

  return canvas.toBuffer('image/png')
}

function drawPostLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number) {
  const tokens = /https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])[@#][A-Za-z0-9_]+/gi
  let cursor = 0
  let drawX = x

  const draw = (text: string, color: string) => {
    if (!text) return
    ctx.fillStyle = color
    ctx.fillText(text, drawX, y)
    drawX += ctx.measureText(text).width
  }

  for (const match of line.matchAll(tokens)) {
    draw(line.slice(cursor, match.index), textColor)
    const token = match[0]
    if (/^https?:\/\//i.test(token)) {
      const url = token.replace(/[.,!?;:]+$/, '')
      draw(url, accentColor)
      draw(token.slice(url.length), textColor)
    }
    else draw(token, accentColor)
    cursor = match.index + token.length
  }
  draw(line.slice(cursor), textColor)
}

export function renderPostOg(body: string, handle: string) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  drawBackground(ctx)

  const fitted = fitPost(ctx, body)
  ctx.font = `500 ${fitted.size}px monospace`
  const textBlockHeight = fitted.lines.length * fitted.lineHeight
  let y = contentTop + Math.max(0, (maxTextHeight - textBlockHeight) / 2) + fitted.size
  for (const line of fitted.lines) {
    drawPostLine(ctx, line, 80, y)
    y += fitted.lineHeight
  }

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

  const profileBio = bio || 'No bio yet.'
  let size = 46
  let lines: string[] = []
  let lineHeight = 61
  for (; size >= 28; size -= 2) {
    ctx.font = `500 ${size}px monospace`
    lines = linesFor(ctx, profileBio, maxTextWidth)
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
  for (const line of lines) {
    ctx.fillText(line, 80, y)
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
