import { clientIpHeaderName } from './brand'
import { ipPseudonym } from './ip-privacy'
import { activeRequest } from './theme'
import { currentUser } from './utils'

// These reveals are temporary, never poll votes or ranking activity.
let currentDay = ''
const totals = new Map<number, Map<number, number>>()
const answers = new Map<string, Map<number, number>>()

function identity(request: Request, at: Date) {
  const day = at.toISOString().slice(0, 10)
  if (day !== currentDay) {
    answers.clear()
    currentDay = day
  }
  const address = request.headers.get(clientIpHeaderName()) || '-'
  return ipPseudonym(address, 'quiz-reveal', at)
}

export function anonymousQuizAnswers(request = activeRequest(), at = new Date()) {
  if (currentUser(request)) return undefined
  return answers.get(identity(request, at))
}

export function answerAnonymousQuiz(request: Request, postId: number, optionId: number, at = new Date()) {
  const key = identity(request, at)
  if (key === '-') return false
  const selections = answers.get(key) || new Map<number, number>()
  if (!selections.has(postId)) {
    selections.set(postId, optionId)
    const options = totals.get(postId) || new Map<number, number>()
    options.set(optionId, (options.get(optionId) || 0) + 1)
    totals.set(postId, options)
  }
  answers.set(key, selections)
  return true
}

export function anonymousQuizTotals(postId: number) {
  return totals.get(postId)
}

export function hasAnonymousQuizTotals() {
  return totals.size > 0
}
