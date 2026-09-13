import { expect, test } from 'bun:test'
import { answerAnonymousQuiz, anonymousQuizAnswers, anonymousQuizTotals } from './anonymous-quiz'
import { clientIpHeaderName } from './brand'

test('anonymous quiz reveals belong to one daily IP pseudonym and retain the first answer', () => {
  const request = new Request('http://localhost', { headers: { [clientIpHeaderName()]: '203.0.113.20' } })
  const other = new Request('http://localhost', { headers: { [clientIpHeaderName()]: '203.0.113.21' } })
  const today = new Date('2026-09-13T23:59:00Z')
  expect(answerAnonymousQuiz(request, 12, 34, today)).toBe(true)
  answerAnonymousQuiz(request, 12, 35, today)
  expect(anonymousQuizAnswers(request, today)?.get(12)).toBe(34)
  expect(anonymousQuizAnswers(other, today)).toBeUndefined()
  expect(anonymousQuizTotals(12)?.get(34)).toBe(1)
  expect(anonymousQuizTotals(12)?.get(35)).toBeUndefined()
  expect(anonymousQuizAnswers(request, new Date('2026-09-14T00:00:00Z'))).toBeUndefined()
  expect(anonymousQuizTotals(12)?.get(34)).toBe(1)
  expect(answerAnonymousQuiz(new Request('http://localhost'), 12, 34, today)).toBe(false)
})
