export const COMPOSE_PLACEHOLDERS = [
  'What’s on your mind, @{handle}?',
  'How is your day going so far, @{handle}?',
  'What’s on the menu, @{handle}?',
  'What are you up to, @{handle}?',
  'What’s happening today, @{handle}?',
  'How are things going, @{handle}?',
  'What are you thinking about, @{handle}?',
  'Anything worth sharing, @{handle}?',
  'What’s the latest, @{handle}?',
  'How’s your corner of the world, @{handle}?',
  'What caught your attention, @{handle}?',
  'What’s keeping you busy, @{handle}?',
  'Any small wins today, @{handle}?',
  'What’s the vibe today, @{handle}?',
  'What have you been pondering, @{handle}?',
  'What’s worth remembering today, @{handle}?',
  'What are you curious about, @{handle}?',
  'How’s life treating you, @{handle}?',
  'What’s your current mood, @{handle}?',
  'What’s something you noticed, @{handle}?',
  'What’s been on your radar, @{handle}?',
  'Got a thought to share, @{handle}?',
  'What are you enjoying lately, @{handle}?',
  'What’s today’s little story, @{handle}?',
  'Anything interesting going on, @{handle}?',
  'What’s floating around in your head, @{handle}?',
  'What would you like to say, @{handle}?',
  'What’s new with you, @{handle}?',
  'How’s your day treating you, @{handle}?',
] as const

export function randomComposePlaceholder(handle: string, random = Math.random) {
  const template = COMPOSE_PLACEHOLDERS[Math.floor(random() * COMPOSE_PLACEHOLDERS.length)]
    ?? COMPOSE_PLACEHOLDERS[0]
  return template.replace('{handle}', handle)
}
