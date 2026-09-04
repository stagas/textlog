import { createCanvas } from 'canvas'
import { writeFile } from 'node:fs/promises'

const cream = '#f4f3ee'
const ink = '#20231f'
const muted = '#60675e'
const sage = '#749668'
const paleSage = '#dfe7db'

function roundedRect(
  ctx: ReturnType<typeof createCanvas>['getContext'],
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

function drawMark(
  ctx: ReturnType<typeof createCanvas>['getContext'],
  x: number,
  y: number,
  size: number,
  color = sage,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fillRect(13, 16, 8, 3)
  ctx.beginPath()
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

function drawWideAd() {
  const canvas = createCanvas(728, 90)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = cream
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = paleSage
  ctx.beginPath()
  ctx.arc(675, 45, 88, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.45
  ctx.beginPath()
  ctx.arc(675, 45, 58, 0, Math.PI * 2)
  ctx.fillStyle = cream
  ctx.fill()
  ctx.globalAlpha = 1

  drawMark(ctx, 26, 24, 42)

  ctx.fillStyle = ink
  ctx.font = '700 24px "DejaVu Sans", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('textlog', 82, 34)

  ctx.fillStyle = muted
  ctx.font = '400 16px "DejaVu Sans", sans-serif'
  ctx.fillText('The quieter social microblogging platform', 82, 61)

  roundedRect(ctx, 610, 28, 88, 34, 17)
  ctx.fillStyle = ink
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 13px "DejaVu Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Join in', 654, 45)

  return canvas.toBuffer('image/png')
}

function drawMobileAd() {
  const canvas = createCanvas(300, 250)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = cream
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = paleSage
  ctx.beginPath()
  ctx.arc(252, 2, 91, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.arc(252, 2, 58, 0, Math.PI * 2)
  ctx.fillStyle = cream
  ctx.fill()
  ctx.globalAlpha = 1

  roundedRect(ctx, 24, 24, 52, 52, 15)
  ctx.fillStyle = ink
  ctx.fill()
  drawMark(ctx, 31, 31, 38, '#9abd8e')

  ctx.fillStyle = ink
  ctx.font = '700 29px "DejaVu Sans", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('textlog', 24, 116)

  ctx.fillStyle = muted
  ctx.font = '400 18px "DejaVu Sans", sans-serif'
  ctx.fillText('The quieter social', 24, 150)
  ctx.fillText('microblogging platform', 24, 176)

  roundedRect(ctx, 24, 197, 106, 34, 17)
  ctx.fillStyle = sage
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 13px "DejaVu Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Join in', 77, 214)

  return canvas.toBuffer('image/png')
}

await Promise.all([
  writeFile(new URL('../public/ad-1.png', import.meta.url), drawWideAd()),
  writeFile(new URL('../public/ad-2.png', import.meta.url), drawMobileAd()),
])
