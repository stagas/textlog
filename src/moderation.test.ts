import { describe, expect, test } from 'bun:test'
import { isModerationFlagged, moderateText, moderationMessage, moderationWarning,
  parseModerationThresholds } from './moderation'

describe('moderation category thresholds', () => {
  test('uses the provider decision when no local thresholds are configured', () => {
    expect(isModerationFlagged({
      flagged: true,
      categories: { violence: true },
      category_scores: { violence: 0.9 },
    }, {})).toBe(true)
    expect(isModerationFlagged({ flagged: false }, {})).toBe(false)
  })

  test('overrides configured positives while retaining other positive categories', () => {
    const thresholds = parseModerationThresholds('violence=0.95')
    expect(isModerationFlagged({
      flagged: true,
      categories: { violence: true },
      category_scores: { violence: 0.8599265510337075 },
    }, thresholds)).toBe(false)
    expect(isModerationFlagged({
      flagged: true,
      categories: { violence: true, harassment: true },
      category_scores: { violence: 0.85, harassment: 0.72 },
    }, thresholds)).toBe(true)
    expect(isModerationFlagged({
      flagged: true,
      categories: { violence: true },
      category_scores: { violence: 0.97 },
    }, thresholds)).toBe(true)
  })

  test('rejects malformed, unknown, out-of-range, and duplicate settings', () => {
    expect(() => parseModerationThresholds('unknown=0.5')).toThrow('invalid moderation category threshold')
    expect(() => parseModerationThresholds('violence=1.1')).toThrow('invalid moderation category threshold')
    expect(() => parseModerationThresholds('violence=0.9,violence=0.8')).toThrow('duplicate')
  })

  test('fails closed when an overridden score is absent', () => {
    expect(isModerationFlagged({ categories: { violence: true } }, { violence: 0.95 })).toBeNull()
  })

  test('shows the highest failing category and score in the rejection message', () => {
    expect(moderationMessage({ ok: false, reason: 'flagged', category: 'violence', score: 0.859926551 }))
      .toContain('violence: 0.8599')
  })

  test('retains a provider positive below the local threshold as a content warning', () => {
    expect(moderationWarning({
      flagged: true,
      categories: { 'self-harm/intent': true },
      category_scores: { 'self-harm/intent': 0.72 },
    }, { 'self-harm/intent': 0.9 })).toEqual({ category: 'self-harm/intent', score: 0.72 })
  })

  test('can use only the provider flagged decision without exposing category details', async () => {
    const previousKey = Bun.env.OPENAI_API_KEY
    const previousDisabled = Bun.env.MODERATION_DISABLED
    const previousThresholds = Bun.env.MODERATION_CATEGORY_THRESHOLDS
    const previousFetch = globalThis.fetch
    Bun.env.OPENAI_API_KEY = 'test'
    Bun.env.MODERATION_DISABLED = 'false'
    Bun.env.MODERATION_CATEGORY_THRESHOLDS = 'violence=0.99'
    globalThis.fetch = (async () => Response.json({ results: [{
      flagged: true,
      categories: { violence: true },
      category_scores: { violence: 0.5 },
    }] })) as unknown as typeof fetch
    try {
      const result = await moderateText('text', { providerFlagOnly: true })
      expect(result).toEqual({ ok: false, reason: 'flagged' })
      if (!result.ok) expect(moderationMessage(result)).not.toContain('violence')
    }
    finally {
      Bun.env.OPENAI_API_KEY = previousKey
      Bun.env.MODERATION_DISABLED = previousDisabled
      Bun.env.MODERATION_CATEGORY_THRESHOLDS = previousThresholds
      globalThis.fetch = previousFetch
    }
  })
})
