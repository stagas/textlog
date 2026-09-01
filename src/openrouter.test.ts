import { describe, expect, test } from 'bun:test'
import { autotagText } from './openrouter'

describe('OpenRouter autotags', () => {
  test('returns the complete enriched text', async () => {
    const result = await autotagText('A note about Bun and TypeScript', {
      apiKey: 'test',
      fetch: (async () => Response.json({ choices: [{ message: {
        content: '```text\nA note about #Bun and #TypeScript\n\n#webdev\n```',
      } }] })),
    })
    expect(result).toEqual({ ok: true, body: 'A note about #Bun and #TypeScript\n\n#webdev' })
  })

  test('falls back to the paid model only after a 429', async () => {
    const models: string[] = []
    const result = await autotagText('A garden note', {
      apiKey: 'test', freeModel: 'example/free', paidModel: 'example/paid',
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        models.push(JSON.parse(String(init?.body)).model)
        return models.length === 1
          ? new Response('rate limited', { status: 429 })
          : Response.json({ choices: [{ message: { content: 'A #garden note\n\n#plants' } }] })
      }),
    })
    expect(models).toEqual(['example/free', 'example/paid'])
    expect(result).toEqual({ ok: true, body: 'A #garden note\n\n#plants' })
  })

  test('does not spend on a paid retry for other failures', async () => {
    let calls = 0
    const result = await autotagText('A note', {
      apiKey: 'test',
      fetch: async () => { calls++; return new Response('bad request', { status: 400 }) },
    })
    expect(calls).toBe(1)
    expect(result.ok).toBe(false)
  })
})
