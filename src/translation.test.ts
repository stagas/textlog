import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { backfillPostTranslations, postTranslation, translateToEnglish } from './translation'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

describe('Google post translation', () => {
  test('sends eligible text as plain text and decodes the translated response', async () => {
    const fetchMock = mock((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      data: { translations: [{ translatedText: 'Hello &amp; welcome' }] },
    }), { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(translateToEnglish('Γεια σου', 'secret key')).resolves.toBe('Hello & welcome')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('?key=secret%20key')
    expect(JSON.parse(String(init?.body))).toEqual({ q: 'Γεια σου', target: 'en', format: 'text' })
  })

  test('does not call Google for notes that did not previously show translate', async () => {
    const fetchMock = mock((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error('should not fetch')))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(postTranslation('An English note 🎉')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('backfills eligible notes serially with one-second gaps and resumes safely', async () => {
    const database = new Database(':memory:', { strict: true })
    database.run(`CREATE TABLE posts(id INTEGER PRIMARY KEY,body TEXT NOT NULL,translation TEXT,deleted_at TEXT);
      INSERT INTO posts VALUES
        (1,'English note',NULL,NULL),
        (2,'Ελληνικό κείμενο',NULL,NULL),
        (3,'Información española: acción',NULL,NULL),
        (4,'Français déjà traduit','Already translated',NULL),
        (5,'Удаленная заметка',NULL,CURRENT_TIMESTAMP);`)
    const events: string[] = []
    const count = await backfillPostTranslations(database, {
      translate: async body => { events.push(`translate:${body}`); return `English ${body}` },
      wait: async milliseconds => { events.push(`wait:${milliseconds}`) },
    })

    expect(count).toBe(2)
    expect(events).toEqual([
      'translate:Ελληνικό κείμενο',
      'wait:1000',
      'translate:Información española: acción',
    ])
    expect(database.query('SELECT id,translation FROM posts ORDER BY id').all()).toEqual([
      { id: 1, translation: null },
      { id: 2, translation: 'English Ελληνικό κείμενο' },
      { id: 3, translation: 'English Información española: acción' },
      { id: 4, translation: 'Already translated' },
      { id: 5, translation: null },
    ])
    expect(await backfillPostTranslations(database, { translate: async () => 'unused', wait: async () => {} }))
      .toBe(0)
  })
})
