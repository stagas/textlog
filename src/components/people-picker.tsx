import React from 'react'
import type { User } from '../types'
import { displayBio, linkify } from '../utils'
import { Layout } from './layout'

export type PopularPerson = { id: number; handle: string; mood?: string | null; bio: string }

export function shouldShowPeoplePicker(user: User | null | undefined) {
  return Boolean(user?.handle_chosen_at && user.tag_prompt_completed_at && !user.people_prompt_completed_at)
}

export function shuffledPeople(people: PopularPerson[], limit = 10, random = Math.random) {
  const shuffled = [...people]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!]
  }
  return shuffled.slice(0, limit)
}

export function PeoplePicker({ user, people, returnTo, error }: {
  user: User
  people: PopularPerson[]
  returnTo: string
  error?: string
}) {
  const displayedPeople = shuffledPeople(people)
  return (
    <Layout user={user} title="pick some people" fullScreen>
      <section className="people-picker" aria-labelledby="people-picker-title">
        <div className="people-picker-card">
          <h1 id="people-picker-title">Pick some people</h1>
          <p>Choose a few people to follow.</p>
          {error && <p className="status-message status-error" role="alert">{error}</p>}
          <form method="post" action="/pick-people">
            <input type="hidden" name="returnTo" value={returnTo} />
            <fieldset className="people-picker-options">
              <legend className="visually-hidden">Popular people</legend>
              {displayedPeople.map(person => (
                <label className="people-picker-option" key={person.id}>
                  <span>
                    <b aria-hidden="true">@</b>
                    {person.handle}
                    {person.mood
                      && <small className="emoji">{person.mood}</small>}
                  </span>
                  {person.bio && (
                    <p className="profile-bio" dangerouslySetInnerHTML={{
                      __html: linkify(displayBio(person.bio)),
                    }} />
                  )}
                  <input className="visually-hidden" type="checkbox" name="people" value={person.id} />
                </label>
              ))}
            </fieldset>
            <button className="button">continue →</button>
          </form>
          <form method="post" action="/pick-people/dismiss" className="people-picker-dismiss">
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="quiet">I'll do it later, thanks</button>
          </form>
        </div>
      </section>
    </Layout>
  )
}
