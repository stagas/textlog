import { describe, expect, test } from 'bun:test'
import { autotagText } from './openrouter'

describe('OpenRouter autotag', () => {
  test('returns the complete enriched text', async () => {
    let systemPrompt = ''
    const result = await autotagText('A note about Bun and TypeScript', {
      apiKey: 'test',
      fetch: (async (_url, init) => {
        systemPrompt = JSON.parse(String(init?.body)).messages[0].content
        return Response.json({ choices: [{ message: {
          content: '```text\nA note about #Bun and #TypeScript\n\n#webdev\n```',
        } }] })
      }),
    })
    expect(result).toEqual({ ok: true, body: 'A note about #Bun and #TypeScript\n\n#webdev' })
    expect(systemPrompt).toContain('15 or fewer')
    expect(systemPrompt).toContain('multiple words')
    expect(systemPrompt).toContain('PascalCase')
    expect(systemPrompt).toContain('without underscores')
    expect(systemPrompt).toContain('synonyms or represent the same concept')
    expect(systemPrompt).toContain('Choose only the shortest hashtag')
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
