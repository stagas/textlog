import type { Database } from 'bun:sqlite'
import { isProbablyNonEnglish } from './components/post'
import { decodeHtmlEntities } from './link-preview'

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'

type TranslateResponse = {
  data?: { translations?: Array<{ translatedText?: string }> }
  error?: { message?: string }
}

export async function translateToEnglish(text: string, apiKey = Bun.env.GOOGLE_TRANSLATE_API_KEY) {
  if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is required to translate notes')
  const response = await fetch(`${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ q: text, target: 'en', format: 'text' }),
  })
  const result = await response.json().catch(() => null) as TranslateResponse | null
  const translated = result?.data?.translations?.[0]?.translatedText
  if (!response.ok || typeof translated !== 'string') {
    throw new Error(`Google Translate failed (${response.status}): ${result?.error?.message || 'invalid response'}`)
  }
  return decodeHtmlEntities(translated)
}

export function postTranslation(body: string) {
  return isProbablyNonEnglish(body) ? translateToEnglish(body) : Promise.resolve(null)
}

export async function backfillPostTranslations(database: Database, options: {
  translate?: (body: string) => Promise<string>
  wait?: (milliseconds: number) => Promise<void>
  onTranslated?: (id: number) => void
} = {}) {
  const translate = options.translate || translateToEnglish
  const wait = options.wait || ((milliseconds: number) => Bun.sleep(milliseconds))
  const rows = database.query(`SELECT id,body FROM posts
    WHERE deleted_at IS NULL AND translation IS NULL ORDER BY id`).all() as Array<{ id: number; body: string }>
  const eligible = rows.filter(row => isProbablyNonEnglish(row.body))
  const update = database.query('UPDATE posts SET translation=? WHERE id=? AND translation IS NULL')
  for (const [index, row] of eligible.entries()) {
    if (index) await wait(1000)
    const translation = await translate(row.body)
    update.run(translation, row.id)
    options.onTranslated?.(row.id)
  }
  return eligible.length
}
