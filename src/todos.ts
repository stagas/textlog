import { withoutMarkdownCode } from './content'

export type TodoItem = { label: string; checked: boolean; line: number }

export type TodoEntry = { type: 'item'; item: TodoItem; itemIndex: number }
  | { type: 'text'; text: string; line: number }

export type TodoDefinition = { items: TodoItem[]; entries: TodoEntry[] }

const todoMarker = /#todo\b/i
const todoPrefix = /^\s*\[([ xX])\](?:[ \t]?)(.*)$/

export function parseTodo(body: string): TodoDefinition | null {
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => todoMarker.test(line))
  if (marker < 0) return null
  const items: TodoItem[] = []
  const entries: TodoEntry[] = lines.slice(marker + 1).map((line, offset) => {
    const match = line.match(todoPrefix)
    const lineNumber = marker + 1 + offset
    if (!match || !match[2].trim()) return { type: 'text', text: line, line: lineNumber }
    const item = { label: match[2].trimEnd(), checked: match[1].toLowerCase() === 'x', line: lineNumber }
    const itemIndex = items.length
    items.push(item)
    return { type: 'item', item, itemIndex }
  })
  if (!items.length) return null
  return { items, entries }
}

export function todoDisplayBody(body: string) {
  const todo = parseTodo(body)
  if (!todo) return body
  const lines = body.split('\n')
  const marker = withoutMarkdownCode(body).split('\n').findIndex(line => todoMarker.test(line))
  return lines.slice(0, marker + 1).join('\n').trimEnd()
}

export function toggleTodo(body: string, itemIndex: number) {
  const todo = parseTodo(body)
  const item = todo?.items[itemIndex]
  if (!item) return null
  const lines = body.split('\n')
  lines[item.line] = lines[item.line].replace(/^(\s*\[)[ xX](\])/, `$1${item.checked ? ' ' : 'x'}$2`)
  return lines.join('\n')
}
