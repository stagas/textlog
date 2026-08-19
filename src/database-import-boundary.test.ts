import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('.', import.meta.url).pathname
const entrypoints = ['app.tsx', 'server.tsx']
const runtimeDirectories = ['routes', 'components']

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx') ? [path] : []
  })
}

test('main-thread application files cannot import SQLite connections', () => {
  const files = [
    ...entrypoints.map(name => join(root, name)),
    ...runtimeDirectories.flatMap(name => sourceFiles(join(root, name))),
  ]
  const violations = files.flatMap(path => {
    const source = readFileSync(path, 'utf8')
    return /from\s+['"]bun:sqlite['"]|from\s+['"](?:\.\.\/)*db['"]|from\s+['"](?:\.\.\/)*cache-db['"]/.test(source)
      ? [path.slice(root.length)]
      : []
  })
  expect(violations).toEqual([])
})
