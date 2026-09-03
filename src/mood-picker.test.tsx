import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MoodPicker, shouldShowMoodPicker } from './components/mood-picker'
import { executeDatabaseDomain } from './database-domain'
import { runMigrations } from './migrations'
import type { User } from './types'

describe('mood prompt', () => {
  test('does not show until the account has picked a handle', () => {
    const user = { id: 1, handle: 'pending', email: 'alice@example.com', bio: '', handle_chosen_at: null } as User
    expect(shouldShowMoodPicker(user)).toBe(false)
    expect(shouldShowMoodPicker({ ...user, handle_chosen_at: '2026-09-01 12:00:00' })).toBe(true)
  })

  test('renders emoji choices, a safe return target, and the permanent dismissal action', () => {
    const html = renderToStaticMarkup(<MoodPicker
      user={{ id: 1, handle: 'alice', email: 'alice@example.com', bio: '' } as User}
      returnTo="/@?page=2"
    />)
    expect(html).toContain('What&#x27;s up?')
    expect(html).toContain('name="mood" value="😊"')
    expect(html).toContain('name="returnTo" value="/@?page=2"')
    expect(html).toContain('I&#x27;ll do it later, thanks')
    expect(html).toContain('action="/pick-mood/dismiss"')
  })

  test('stores either the selected mood or a permanent dismissal', async () => {
    const database = new Database(':memory:')
    runMigrations(database)
    database.run('INSERT INTO users(id,handle,email,password) VALUES(1,\'alice\',\'alice@example.com\',\'x\')')

    await executeDatabaseDomain(database, 'account.answerMoodPrompt', { userId: 1, mood: '😌' })
    const selected = database.query(
      'SELECT mood,mood_prompt_dismissed_at dismissed FROM users WHERE id=1',
    ).get() as { mood: string; dismissed: string | null }
    expect(selected.mood).toBe('😌')
    expect(selected.dismissed).not.toBeNull()

    database.run('UPDATE users SET mood=\'\' WHERE id=1')
    expect((database.query('SELECT mood_prompt_dismissed_at dismissed FROM users WHERE id=1').get() as {
      dismissed: string | null
    }).dismissed).not.toBeNull()
    database.run('UPDATE users SET mood_prompt_dismissed_at=NULL WHERE id=1')
    await executeDatabaseDomain(database, 'account.answerMoodPrompt', { userId: 1, mood: null })
    const row = database.query('SELECT mood_prompt_dismissed_at dismissed FROM users WHERE id=1').get() as {
      dismissed: string | null
    }
    expect(row.dismissed).not.toBeNull()
  })
})
