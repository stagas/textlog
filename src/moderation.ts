type ModerationResult =
  | { ok: true }
  | { ok: false; reason: 'flagged' | 'rate_limited' | 'unavailable' }

export async function moderateText(input: string): Promise<ModerationResult> {
  if (['1', 'true', 'yes'].includes((Bun.env.MODERATION_DISABLED || '').toLowerCase())) {
    return { ok: true }
  }

  const apiKey = Bun.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, reason: 'unavailable' }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      const details = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
      console.error('Moderation request failed', {
        status: response.status,
        code: details?.error?.code,
        message: details?.error?.message,
        requestId: response.headers.get('x-request-id'),
        limitRequests: response.headers.get('x-ratelimit-limit-requests'),
        remainingRequests: response.headers.get('x-ratelimit-remaining-requests'),
        resetRequests: response.headers.get('x-ratelimit-reset-requests'),
        limitTokens: response.headers.get('x-ratelimit-limit-tokens'),
        remainingTokens: response.headers.get('x-ratelimit-remaining-tokens'),
        resetTokens: response.headers.get('x-ratelimit-reset-tokens'),
        retryAfter: response.headers.get('retry-after'),
      })
      return { ok: false, reason: response.status === 429 ? 'rate_limited' : 'unavailable' }
    }
    const data = await response.json() as { results?: { flagged?: boolean }[] }
    if (!data.results?.length) return { ok: false, reason: 'unavailable' }
    return data.results[0].flagged ? { ok: false, reason: 'flagged' } : { ok: true }
  } catch (error) {
    console.error('Moderation request failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}

export function moderationMessage(reason: 'flagged' | 'rate_limited' | 'unavailable') {
  if (reason === 'flagged') return 'This text may violate our content rules. Please revise it and try again.'
  if (reason === 'rate_limited') return 'Content verification is busy right now. Please wait a moment and try again.'
  return 'We could not verify this text right now. Please try again in a moment.'
}
