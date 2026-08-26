import { describe, expect, test } from 'bun:test'
import { createCanvas, Image } from 'canvas'
import { fitPost, postOgText, renderDefaultOg, renderFollowBadge, renderPostOg, renderProfileOg,
  renderTagOg } from './og'
import { pollDisplayBody } from './polls'

function visiblePixels(imageBuffer: Buffer, x: number, y: number, width: number, height: number) {
  const image = new Image()
  image.src = imageBuffer
  const canvas = createCanvas(1200, 630)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(x, y, width, height).data
  let visible = 0
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] !== 17 || pixels[index + 1] !== 21 || pixels[index + 2] !== 18) visible++
  }
  return visible
}

describe('renderPostOg', () => {
  test('keeps long post text readable and truncates it after five short lines', () => {
    const context = createCanvas(1200, 630).getContext('2d')
    const fitted = fitPost(context, Array.from({ length: 80 }, (_, index) => `word${index}`).join(' '))
    expect(fitted.size).toBe(52)
    expect(fitted.lines).toHaveLength(5)
    expect(fitted.lines.every(line => line.length <= 34)).toBe(true)
    expect(fitted.lines[4]).toEndWith('…')
  })

  test('renders markdown links as their label without the URL', () => {
    expect(postOgText('Read [the docs](https://example.com/docs) today')).toEqual({
      text: 'Read the docs today',
      links: [{ start: 5, end: 13 }],
      code: [],
      math: [],
      styles: { bold: [], italics: [], underline: [], strikethrough: [], redacted: [], quote: [] },
    })
    expect(renderPostOg('Read [the docs](https://example.com/docs) today', 'tester')).not.toHaveLength(0)
  })

  test('removes formatting markers and records all post text styles', () => {
    expect(postOgText('> *bold* /italic/ _under_ ~gone~ |secret|')).toEqual({
      text: 'bold italic under gone secret',
      links: [],
      code: [],
      math: [],
      styles: {
        bold: [{ start: 0, end: 4 }],
        italics: [{ start: 5, end: 11 }],
        underline: [{ start: 12, end: 17 }],
        strikethrough: [{ start: 18, end: 22 }],
        redacted: [{ start: 23, end: 29 }],
        quote: [{ start: 0, end: 29 }],
      },
    })
    expect(renderPostOg('> *bold* /italic/ _under_ ~gone~ |secret|', 'tester')).not.toHaveLength(0)
  })

  test('omits unrevealed spoiler text from the image', () => {
    expect(postOgText('Visible setup\n#spoiler\nSecret ending')).toMatchObject({
      text: 'Visible setup\n#spoiler',
    })
    expect(renderPostOg('Visible setup\n#spoiler\nSecret ending', 'tester')).not.toHaveLength(0)
  })

  test('renders poll questions with visually distinct answer rows', () => {
    expect(postOgText(pollDisplayBody('Tea or coffee?\n#poll\nTea\nCoffee')).text)
      .toBe('Tea or coffee?\n#poll')
    const image = renderPostOg('Tea or coffee?\n#poll\nTea\nCoffee', 'tester')
    expect(visiblePixels(image, 70, 375, 1060, 145)).toBeGreaterThan(10_000)
  })

  test('identifies everything the content renderer linkifies', () => {
    expect(postOgText('See example.com, @tester and #textlog')).toEqual({
      text: 'See example.com, @tester and #textlog',
      links: [
        { start: 4, end: 15 },
        { start: 17, end: 24 },
        { start: 29, end: 37 },
      ],
      code: [],
      math: [],
      styles: { bold: [], italics: [], underline: [], strikethrough: [], redacted: [], quote: [] },
    })
    expect(postOgText('Keep `example.com` literal')).toEqual({
      text: 'Keep example.com literal',
      links: [],
      code: [{ start: 5, end: 16 }],
      math: [],
      styles: { bold: [], italics: [], underline: [], strikethrough: [], redacted: [], quote: [] },
    })
    expect(postOgText('Before\n```js\nconst answer = 42\n```\nafter')).toEqual({
      text: 'Before\nconst answer = 42\nafter',
      links: [],
      code: [{ start: 7, end: 24 }],
      math: [],
      styles: { bold: [], italics: [], underline: [], strikethrough: [], redacted: [], quote: [] },
    })
  })

  test('typesets inline and display LaTeX without showing delimiters', () => {
    const content = postOgText('Inline $x^2 + y^2$ here.\n$$\\sum_{i=1}^n i$$\nDone.')
    expect(content.text).not.toContain('$')
    expect(content.math).toEqual([
      { start: 7, end: 13, source: 'x^2 + y^2', display: false },
      { start: 20, end: 24, source: '\\sum_{i=1}^n i', display: true },
    ])
    const inlineImage = renderPostOg('Inline $x^2 + y^2$ here.', 'tester')
    expect(visiblePixels(inlineImage, 430, 240, 350, 170)).toBeGreaterThan(500)
    const displayImage = renderPostOg('$$\\sum_{i=1}^n i$$', 'tester')
    expect(visiblePixels(displayImage, 70, 150, 400, 330)).toBeGreaterThan(500)
    const fenced = postOgText('```latex\n\\frac{a}{b}\n```')
    expect(fenced.text).not.toContain('```')
    expect(fenced.math).toHaveLength(1)
    expect(fenced.math[0]).toMatchObject({ source: '\\frac{a}{b}', display: true })
  })
})

describe('renderProfileOg', () => {
  test('renders a 1200 by 630 PNG', () => {
    const image = renderProfileOg('tester', 'A short bio about the profile owner.')
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })

  test('renders empty and multiline bios', () => {
    expect(renderProfileOg('tester', '')).not.toHaveLength(0)
    expect(renderProfileOg('tester', 'first line\nsecond line')).not.toHaveLength(0)
  })

  test('renders linkified bio content', () => {
    expect(renderProfileOg('tester', 'At [my site](https://example.com), with @friend and #writing.'))
      .not.toHaveLength(0)
    expect(renderProfileOg('tester', 'Studies $E = mc^2$ and $$x = \\frac{-b}{2a}$$'))
      .not.toHaveLength(0)
  })
})

describe('renderFollowBadge', () => {
  test('renders a compact PNG sized to its handle', () => {
    const short = renderFollowBadge('ana')
    const long = renderFollowBadge('a_longer_handle')
    expect(short.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(short.readUInt32BE(20)).toBe(64)
    expect(long.readUInt32BE(16)).toBeGreaterThan(short.readUInt32BE(16))
  })
})

describe('renderTagOg', () => {
  test('renders a 1200 by 630 PNG', () => {
    const image = renderTagOg('typescript', 42)
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })
})

describe('renderDefaultOg', () => {
  test('renders a 1200 by 630 PNG', () => {
    const image = renderDefaultOg()
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
  })
})
