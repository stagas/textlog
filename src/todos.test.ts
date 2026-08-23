import { describe, expect, test } from 'bun:test'
import { parseTodo, todoDisplayBody, toggleTodo } from './todos'

describe('todos', () => {
  test('parses plain and checked lines after the todo marker', () => {
    const todo = parseTodo('Weekend #todo\nBuy milk\n[x] Call Sam\n[ ] Pack')!
    expect(todo.items).toEqual([
      { label: 'Call Sam', checked: true, line: 2 },
      { label: 'Pack', checked: false, line: 3 },
    ])
    expect(todo.entries[0]).toEqual({ type: 'text', text: 'Buy milk', line: 1 })
  })

  test('accepts a todo hashtag anywhere on its line', () => {
    expect(parseTodo("my today's #todo list\n[x] wake up\n[ ] drink coffee")?.items).toEqual([
      { label: 'wake up', checked: true, line: 1 },
      { label: 'drink coffee', checked: false, line: 2 },
    ])
    expect(parseTodo("my today's [#todo](http://localhost:3000/tag/todo) list\nwork")).toBeNull()
  })

  test('does not activate a todo marker inside fenced code', () => {
    expect(parseTodo('Example:\n```text\n#todo\n[ ] Buy milk\n```')).toBeNull()
  })

  test('keeps the visible heading and marker out of the item list', () => {
    expect(todoDisplayBody('Weekend\n#todo\nnotes stay\n[ ] Buy milk')).toBe('Weekend\n#todo')
    expect(todoDisplayBody("my today's #todo list\nBuy milk")).toBe("my today's #todo list\nBuy milk")
  })

  test('toggles an item by rewriting the post body', () => {
    expect(toggleTodo('#todo\n[ ] Buy milk\n[x] Call Sam', 0)).toBe('#todo\n[x] Buy milk\n[x] Call Sam')
    expect(toggleTodo('#todo\n[ ] Buy milk\n[x] Call Sam', 1)).toBe('#todo\n[ ] Buy milk\n[ ] Call Sam')
    expect(toggleTodo('#todo\n[ ] Buy milk', 2)).toBeNull()
  })

  test('preserves whitespace and non-todo lines', () => {
    const body = "my today's #todo list\n\n[x] wake up\nplain note\n[ ] work"
    expect(parseTodo(body)?.entries.map(entry => entry.type === 'text' ? entry.text : entry.item.label))
      .toEqual(['', 'wake up', 'plain note', 'work'])
    expect(todoDisplayBody(body)).toBe("my today's #todo list")
    expect(toggleTodo('x #todo\n  [ ]   spaced item  ', 0)).toBe('x #todo\n  [x]   spaced item  ')
  })
})
