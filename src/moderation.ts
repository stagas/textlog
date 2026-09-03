type ModerationFailure =
  | { ok: false; reason: 'flagged'; category: ModerationCategory; score: number }
  | { ok: false; reason: 'rate_limited' | 'unavailable' }

type ModerationResult =
  | { ok: true; warning?: { category: ModerationCategory; score: number } }
  | ModerationFailure

const moderationCategories = [
  'sexual',
  'sexual/minors',
  'harassment',
  'harassment/threatening',
  'hate',
  'hate/threatening',
  'illicit',
  'illicit/violent',
  'self-harm',
  'self-harm/intent',
  'self-harm/instructions',
  'violence',
  'violence/graphic',
] as const

type ModerationCategory = typeof moderationCategories[number]
export type ModerationThresholds = Partial<Record<ModerationCategory, number>>

export function parseModerationThresholds(value: string | undefined): ModerationThresholds {
  const thresholds: ModerationThresholds = {}
  if (!value?.trim()) return thresholds

  for (const entry of value.split(',')) {
    const [rawCategory, rawThreshold, ...extra] = entry.split('=')
    const category = rawCategory?.trim() as ModerationCategory
    const threshold = Number(rawThreshold?.trim())
    if (extra.length || !moderationCategories.includes(category) || rawThreshold === undefined
      || rawThreshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    {
      throw new Error(`invalid moderation category threshold: ${entry.trim() || '(empty)'}`)
    }
    if (thresholds[category] !== undefined) throw new Error(`duplicate moderation category threshold: ${category}`)
    thresholds[category] = threshold
  }
  return thresholds
}

type ModerationApiResult = {
  flagged?: boolean
  categories?: Partial<Record<ModerationCategory, boolean>>
  category_scores?: Partial<Record<ModerationCategory, number>>
}

export function isModerationFlagged(result: ModerationApiResult, thresholds: ModerationThresholds) {
  const decision = moderationMatch(result, thresholds)
  return decision === null ? null : decision !== false
}

function moderationMatch(result: ModerationApiResult, thresholds: ModerationThresholds): false | {
  category: ModerationCategory
  score: number
} | null {
  if (!Object.keys(thresholds).length && result.flagged !== true) return false

  const matches: { category: ModerationCategory; score: number }[] = []

  for (const category of moderationCategories) {
    const threshold = thresholds[category]
    if (threshold === undefined) {
      if (result.categories?.[category] !== true) continue
      const score = result.category_scores?.[category]
      if (typeof score !== 'number' || !Number.isFinite(score)) return null
      matches.push({ category, score })
      continue
    }
    const score = result.category_scores?.[category]
    // A configured category missing its score is an invalid response, not an automatic pass.
    if (typeof score !== 'number' || !Number.isFinite(score)) return null
    if (score >= threshold) matches.push({ category, score })
  }
  if (!matches.length) return Object.keys(thresholds).length ? false : null
  return matches.reduce((highest, match) => match.score > highest.score ? match : highest)
}

export function moderationWarning(result: ModerationApiResult, thresholds: ModerationThresholds) {
  const warnings: { category: ModerationCategory; score: number }[] = []
  for (const category of moderationCategories) {
    const threshold = thresholds[category]
    const score = result.category_scores?.[category]
    if (threshold !== undefined && result.categories?.[category] === true && typeof score === 'number'
      && Number.isFinite(score) && score < threshold)
    {
      warnings.push({ category, score })
    }
  }
  return warnings.length
    ? warnings.reduce((highest, warning) => warning.score > highest.score ? warning : highest)
    : undefined
}

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
    const data = await response.json() as { results?: ModerationApiResult[] }
    if (!data.results?.length) return { ok: false, reason: 'unavailable' }
    const match = moderationMatch(data.results[0], parseModerationThresholds(Bun.env.MODERATION_CATEGORY_THRESHOLDS))
    if (match === null) return { ok: false, reason: 'unavailable' }
    return match
      ? { ok: false, reason: 'flagged', ...match }
      : { ok: true,
        warning: moderationWarning(data.results[0], parseModerationThresholds(Bun.env.MODERATION_CATEGORY_THRESHOLDS)) }
  }
  catch (error) {
    console.error('Moderation request failed', error)
    return { ok: false, reason: 'unavailable' }
  }
}

export function moderationMessage(result: ModerationFailure) {
  if (result.reason === 'flagged') {
    return `This text may violate our content rules (${result.category}: ${
      result.score.toFixed(4)
    }). Please revise it and try again.`
  }
  if (result.reason === 'rate_limited') {
    return 'Content verification is busy right now. Please wait a moment and try again.'
  }
  return 'We could not verify this text right now. Please try again in a moment.'
}

export function moderatedContentDescription(category: string) {
  return `(moderated due to ${category})`
}
