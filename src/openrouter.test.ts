import { describe, expect, test } from 'bun:test'
import { autotagText } from './openrouter'

describe('OpenRouter autotag', () => {
  test('returns the complete enriched text', async () => {
    let systemPrompt = ''
    const result = await autotagText('A note about Bun and TypeScript', {
      apiKey: 'test',
      moderate: async () => ({ ok: true }),
      fetch: (async (_url, init) => {
        systemPrompt = JSON.parse(String(init?.body)).messages[0].content
        return Response.json({ choices: [{ message: {
          content: '```text\nA note about #Bun and #TypeScript\n\n#webdev\n```',
        } }] })
      }),
    })
    expect(result).toEqual({ ok: true, body: 'A note about #Bun and #TypeScript\n\n#webdev' })
    expect(systemPrompt).toContain('5 or fewer')
    expect(systemPrompt).toContain('multiple words')
    expect(systemPrompt).toContain('PascalCase')
    expect(systemPrompt).toContain('without underscores')
    expect(systemPrompt).toContain('single-word hashtags lowercase')
    expect(systemPrompt).toContain('location, proper noun, acronym')
    expect(systemPrompt).toContain('synonyms or represent the same concept')
    expect(systemPrompt).toContain('Choose only the shortest hashtag')
  })

  test('falls back to the paid model only after a 429', async () => {
    const models: string[] = []
    const result = await autotagText('A garden note', {
      apiKey: 'test',
      moderate: async () => ({ ok: true }),
      freeModel: 'example/free',
      paidModel: 'example/paid',
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
      moderate: async () => ({ ok: true }),
      fetch: async () => {
        calls++
        return new Response('bad request', { status: 400 })
      },
    })
    expect(calls).toBe(1)
    expect(result.ok).toBe(false)
  })

  test('moderates before contacting OpenRouter and rejects flagged text', async () => {
    const calls: string[] = []
    const result = await autotagText('malicious text', {
      apiKey: 'test',
      moderate: async input => {
        calls.push(`moderate:${input}`)
        return { ok: false, reason: 'flagged', category: 'violence', score: 0.99 }
      },
      fetch: async () => {
        calls.push('openrouter')
        return Response.json({ choices: [{ message: { content: '#text' } }] })
      },
    })
    expect(calls).toEqual(['moderate:malicious text'])
    expect(result).toMatchObject({ ok: false, reason: 'flagged' })
    if (!result.ok) expect(result.message).toBe('This text may violate our content rules. Please revise it and try again.')
    if (!result.ok) expect(result.message).not.toContain('0.99')
  })

  test('does not send text to OpenRouter when moderation is unavailable', async () => {
    let contactedProvider = false
    const result = await autotagText('A note', {
      apiKey: 'test',
      moderate: async () => ({ ok: false, reason: 'unavailable' }),
      fetch: async () => {
        contactedProvider = true
        return Response.json({})
      },
    })
    expect(contactedProvider).toBe(false)
    expect(result).toMatchObject({ ok: false, reason: 'moderation_unavailable' })
  })
})
