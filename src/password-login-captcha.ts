import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import svgCaptcha from 'svg-captcha'

export const CAPTCHA_FAILURE_THRESHOLD = 10
export const CAPTCHA_WINDOW_MS = 10 * 60 * 1000
export const CAPTCHA_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000

const answerHash = (token: string, answer: string) =>
  createHash('sha256')
    .update(`textlog password captcha\0${token}\0${answer.trim().toLowerCase()}`)
    .digest('hex')

export function passwordCaptchaRequired(database: Database, now = Date.now()) {
  if (Bun.env.ENABLE_CAPTCHA_ALWAYS === 'true') return true
  const state = database.query('SELECT required_until FROM password_captcha_state WHERE id=1')
    .get() as { required_until: number } | null
  return Boolean(state && state.required_until > now)
}

export function recordFailedPassword(database: Database, now = Date.now()) {
  return database.transaction(() => {
    database.query('DELETE FROM password_login_failures WHERE created_at<=?').run(now - CAPTCHA_WINDOW_MS)
    database.query('INSERT INTO password_login_failures(created_at) VALUES(?)').run(now)
    const state = database.query('SELECT required_until FROM password_captcha_state WHERE id=1')
      .get() as { required_until: number } | null
    const failures = (database.query('SELECT count(*) count FROM password_login_failures')
      .get() as { count: number }).count
    if ((state?.required_until || 0) > now || failures >= CAPTCHA_FAILURE_THRESHOLD) {
      database.query(`INSERT INTO password_captcha_state(id,required_until) VALUES(1,?)
        ON CONFLICT(id) DO UPDATE SET required_until=excluded.required_until`).run(now + CAPTCHA_WINDOW_MS)
      return true
    }
    return false
  })()
}

export function issuePasswordCaptcha(database: Database, now = Date.now()) {
  const generated = svgCaptcha.create({ size: 6, noise: 3, color: true, background: '#f4f1ea' })
  const token = randomUUID()
  database.transaction(() => {
    database.query('DELETE FROM password_captcha_challenges WHERE expires_at<=?').run(now)
    database.query('INSERT INTO password_captcha_challenges(token,answer_hash,expires_at) VALUES(?,?,?)')
      .run(token, answerHash(token, generated.text), now + CAPTCHA_CHALLENGE_LIFETIME_MS)
  })()
  return { token, image: `data:image/svg+xml;base64,${Buffer.from(generated.data).toString('base64')}` }
}

export function consumePasswordCaptcha(database: Database, token: string, answer: string, now = Date.now()) {
  if (!token || !answer) return false
  return database.transaction(() => {
    const challenge = database.query(
      'SELECT answer_hash FROM password_captcha_challenges WHERE token=? AND expires_at>?',
    ).get(token, now) as { answer_hash: string } | null
    database.query('DELETE FROM password_captcha_challenges WHERE token=? OR expires_at<=?').run(token, now)
    return challenge?.answer_hash === answerHash(token, answer)
  })()
}
