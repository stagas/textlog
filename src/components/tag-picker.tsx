import React from 'react'
import type { User } from '../types'
import { Layout } from './layout'

export type PopularTag = { tag: string; displayName?: string | null; count: number }

export function shouldShowTagPicker(user: User | null | undefined) {
  return Boolean(user?.handle_chosen_at && user.mood_prompt_dismissed_at && !user.tag_prompt_completed_at)
}

export function TagPicker({ user, tags, returnTo, error }: {
  user: User
  tags: PopularTag[]
  returnTo: string
  error?: string
}) {
  return (
    <Layout user={user} title="pick some tags" fullScreen>
      <section className="tag-picker" aria-labelledby="tag-picker-title">
        <div className="tag-picker-card">
          <h1 id="tag-picker-title">Pick some tags</h1>
          <p>Choose a few topics to follow.</p>
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          <form method="post" action="/pick-tags">
            <input type="hidden" name="returnTo" value={returnTo} />
            <fieldset className="tag-picker-options">
              <legend className="visually-hidden">Popular hashtags</legend>
              {tags.map(({ tag, displayName }) => (
                <label className="tag-picker-option" key={tag}>
                  <span><b aria-hidden="true">#</b>{displayName || tag}</span>
                  <input className="visually-hidden" type="checkbox" name="tags" value={tag} />
                </label>
              ))}
            </fieldset>
            <button className="button">continue →</button>
          </form>
          <form method="post" action="/pick-tags/dismiss" className="tag-picker-dismiss">
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="quiet">I'll do it later, thanks</button>
          </form>
        </div>
      </section>
    </Layout>
  )
}
