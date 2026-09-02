import React from 'react'
import type { User } from '../types'
import { Layout } from './layout'

export const MOOD_CHOICES = [
  '😊', '😌', '🥰', '😎', '🤩', '🤔', '😴', '😢',
  '😤', '😰', '🤒', '🤪', '🥳', '🤠', '🤡', '🥸',
  '🤖', '👽', '👻', '😈', '👹', '💀', '🧙', '🧝',
  '🧚', '🧛', '🥷', '🦸', '🦹', '🧞', '🧜', '🧑‍🚀',
] as const

export function shouldShowMoodPicker(user: User | null | undefined) {
  return Boolean(user?.handle_chosen_at && !user.mood && !user.mood_prompt_dismissed_at)
}

export function MoodPicker({ user, returnTo }: { user: User; returnTo: string }) {
  return (
    <Layout user={user} title="pick a mood" fullScreen>
      <section className="mood-picker" aria-labelledby="mood-picker-title">
        <div className="mood-picker-card">
          <h1 id="mood-picker-title">What's up?</h1>
          <p>Pick a mood to show beside your name.</p>
          <div className="mood-picker-options">
            {MOOD_CHOICES.map(mood => (
              <form method="post" action="/pick-mood" key={mood}>
                <input type="hidden" name="mood" value={mood} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" className="mood-picker-option emoji" aria-label={`Choose ${mood}`}>{mood}</button>
              </form>
            ))}
          </div>
          <form method="post" action="/pick-mood/dismiss" className="mood-picker-dismiss">
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="quiet">I'll do it later, thanks</button>
          </form>
        </div>
      </section>
    </Layout>
  )
}
