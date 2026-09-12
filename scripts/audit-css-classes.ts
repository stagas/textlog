export {}

const sourceGlob = new Bun.Glob('{src,public}/**/*.{ts,tsx,js}')
const sources: string[] = []
for await (const path of sourceGlob.scan('.')) sources.push(await Bun.file(path).text())
const source = sources.join('\n')
const css = await Bun.file('src/styles.css').text()
const classes = new Set([...css.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)].map(match => match[1]!))

// These families are assembled from validated appearance choices or emitted by highlight.js at runtime.
const generatedClassFamilies = [
  /^accent-swatch-(?:theme(?:-(?:system|light|dark|sepia|dracula))?|sage|purple|cyan|pink|blue|amber)$/,
  /^theme-preview-(?:system|light|dark|sepia|dracula)$/,
  /^font-preview-/,
  /^font-size-(?:small|regular|large|larger)$/,
  /^primary-font-(?:monospace|sans-serif)$/,
  /^density-(?:compact|regular|relaxed)$/,
  /^density-preview-(?:compact|regular|relaxed)$/,
  /^corner-preview-(?:sharp|round)$/,
  /^corners-(?:sharp|round)$/,
  /^profile-presence-panel-(?:light|dark|sepia|dracula)$/,
  /^hljs-/,
]

const unused = [...classes].filter(className => !source.includes(className)
  && !generatedClassFamilies.some(pattern => pattern.test(className))).sort()

if (unused.length) {
  console.log(`Potentially unused CSS classes (${unused.length}):`)
  console.log(unused.join('\n'))
  if (process.argv.includes('--check')) process.exitCode = 1
}
else console.log('No potentially unused CSS classes found.')
