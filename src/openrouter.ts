const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_FREE_MODEL = 'google/gemma-4-26b-a4b-it:free'
const DEFAULT_PAID_MODEL = 'google/gemma-4-26b-a4b-it'

type OpenRouterCompletion = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type AutotagResult =
  | { ok: true; body: string }
  | { ok: false; message: string }

function completionText(payload: OpenRouterCompletion) {
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  return content?.map(part => part.text || '').join('') || ''
}

function enrichedText(text: string) {
  return text.replace(/^\s*```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

async function requestAutotags(body: string, model: string, apiKey: string, request: Fetcher) {
  return await request(OPENROUTER_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: 'Enrich this text with hashtags, replacing words with their hashtag version (prepending hash) and adding in the end possible new hashtags. Keep the total number of hashtags fewer than 5. Return only the complete enriched text, preserving its meaning, formatting, and language. Do not add commentary.' },
        { role: 'user', content: body },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
}

export async function autotagText(body: string, options: {
  apiKey?: string
  freeModel?: string
  paidModel?: string
  fetch?: Fetcher
} = {}): Promise<AutotagResult> {
  const apiKey = options.apiKey ?? Bun.env.OPENROUTER_API_KEY
  if (!apiKey) return { ok: false, message: 'Autotags are not configured.' }
  const freeModel = options.freeModel || Bun.env.OPENROUTER_FREE_MODEL || DEFAULT_FREE_MODEL
  const paidModel = options.paidModel || Bun.env.OPENROUTER_PAID_MODEL || DEFAULT_PAID_MODEL
  const request = options.fetch || fetch
  try {
    let response = await requestAutotags(body, freeModel, apiKey, request)
    if (response.status === 429 && paidModel !== freeModel) {
      response = await requestAutotags(body, paidModel, apiKey, request)
    }
    if (!response.ok) return { ok: false, message: 'Could not add autotags right now. Please try again.' }
    const enriched = enrichedText(completionText(await response.json() as OpenRouterCompletion))
    return enriched
      ? { ok: true, body: enriched }
      : { ok: false, message: 'No useful autotags were found.' }
  }
  catch {
    return { ok: false, message: 'Could not add autotags right now. Please try again.' }
  }
}
