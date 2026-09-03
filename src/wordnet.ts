import wordnet from 'wordnet'
import wordnetDb from 'wordnet-db'

type WordNetWord = { word: string }
type WordNetPointer = { pointerSymbol: string; data?: WordNetEntry }
type WordNetEntry = {
  meta: {
    synsetType: 'noun' | 'verb' | 'adjective' | 'adjective satellite' | 'adverb'
    words: WordNetWord[]
    pointers: WordNetPointer[]
  }
}

const normalizedWords = new Map<string, Promise<string>>()
let ready: Promise<void> | undefined

function initializeWordNet() {
  return ready ||= wordnet.init(wordnetDb.path)
}

async function lookup(word: string) {
  await initializeWordNet()
  try {
    return await wordnet.lookup(word) as WordNetEntry[]
  }
  catch {
    return []
  }
}

function hashtagWord(word: string) {
  return word.normalize('NFC').toLowerCase().replaceAll('_', '')
}

function adjectiveForAdverb(word: string) {
  if (!word.endsWith('ly') || word.length <= 4) return null
  return word.slice(0, -2)
}

// WordNet's morphy noun detachment rules. A candidate is accepted only when
// WordNet itself contains it as a noun, so words such as "news" stay intact.
function nounInflections(word: string) {
  const candidates: string[] = []
  const replace = (suffix: string, replacement: string) => {
    if (word.endsWith(suffix) && word.length > suffix.length) {
      candidates.push(word.slice(0, -suffix.length) + replacement)
    }
  }
  replace('s', '')
  replace('ses', 's')
  replace('xes', 'x')
  replace('zes', 'z')
  replace('ches', 'ch')
  replace('shes', 'sh')
  replace('men', 'man')
  replace('ies', 'y')
  return [...new Set(candidates)]
}

async function normalizeUncached(word: string) {
  const original = hashtagWord(word)
  if (!/^[a-z]+$/.test(original)) return original

  const candidates: string[] = []
  const seen = new Set<string>()
  const visit = async (candidate: string, depth: number): Promise<string | null> => {
    if (seen.has(candidate) || depth > 2) return null
    seen.add(candidate)
    const entries = await lookup(candidate)
    for (const entry of entries) {
      for (const synonym of entry.meta.words || []) {
        const value = hashtagWord(synonym.word)
        if (value && !candidates.includes(value)) candidates.push(value)
        if (entry.meta.synsetType === 'noun' && value === candidate) return value
      }
    }
    for (const entry of entries) {
      for (const pointer of entry.meta.pointers || []) {
        // WordNet uses + for derivations and \\ for an adverb's source adjective.
        if (pointer.pointerSymbol !== '+' && pointer.pointerSymbol !== '\\') continue
        for (const related of pointer.data?.meta.words || []) {
          const result: string | null = await visit(hashtagWord(related.word), depth + 1)
          if (result) return result
        }
      }
    }
    return null
  }

  const direct = await visit(original, 0)
  if (direct) return direct
  const adjective = adjectiveForAdverb(original)
  if (adjective) {
    const derived = await visit(adjective, 0)
    if (derived) return derived
  }
  for (const singular of nounInflections(original)) {
    const entries = await lookup(singular)
    if (entries.some(entry => entry.meta.synsetType === 'noun')) return singular
  }
  for (const candidate of candidates) {
    if ((await lookup(candidate)).some(entry => entry.meta.synsetType === 'noun')) return candidate
  }
  return original
}

/** Resolve an English word to a noun topic when WordNet provides a derivation. */
export function normalizeWord(word: string): Promise<string> {
  const normalized = hashtagWord(word)
  let pending = normalizedWords.get(normalized)
  if (!pending) {
    pending = normalizeUncached(normalized)
    normalizedWords.set(normalized, pending)
  }
  return pending
}
