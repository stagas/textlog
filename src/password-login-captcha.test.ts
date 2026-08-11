import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { CAPTCHA_FAILURE_THRESHOLD, CAPTCHA_WINDOW_MS, consumePasswordCaptcha, issuePasswordCaptcha,
  passwordCaptchaRequired, recordFailedPassword } from './password-login-captcha'

function testDatabase() {
  const database = new Database(':memory:', { strict: true })
  database.run(`CREATE TABLE password_login_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL);
  CREATE TABLE password_captcha_state (id INTEGER PRIMARY KEY,required_until INTEGER NOT NULL);
  CREATE TABLE password_captcha_challenges (token TEXT PRIMARY KEY,answer_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);`)
  return database
}

describe('global password CAPTCHA', () => {
  test('can be required permanently through the environment', () => {
    const previous = Bun.env.ENABLE_CAPTCHA_ALWAYS
    Bun.env.ENABLE_CAPTCHA_ALWAYS = 'true'
    try {
      expect(passwordCaptchaRequired(testDatabase(), Number.MAX_SAFE_INTEGER)).toBe(true)
    }
    finally {
      if (previous === undefined) Bun.env.ENABLE_CAPTCHA_ALWAYS = undefined
      else Bun.env.ENABLE_CAPTCHA_ALWAYS = previous
    }
  })

  test('activates after failures across the server and rolls from each later failure', () => {
    const previous = Bun.env.ENABLE_CAPTCHA_ALWAYS
    Bun.env.ENABLE_CAPTCHA_ALWAYS = 'false'
    const database = testDatabase()
    try {
      for (let attempt = 1; attempt < CAPTCHA_FAILURE_THRESHOLD; attempt++) {
        expect(recordFailedPassword(database, 1_000 + attempt)).toBe(false)
      }
      expect(recordFailedPassword(database, 2_000)).toBe(true)
      expect(passwordCaptchaRequired(database, 2_000 + CAPTCHA_WINDOW_MS - 1)).toBe(true)

      const laterFailure = 2_000 + CAPTCHA_WINDOW_MS - 100
      expect(recordFailedPassword(database, laterFailure)).toBe(true)
      expect(passwordCaptchaRequired(database, laterFailure + CAPTCHA_WINDOW_MS - 1)).toBe(true)
      expect(passwordCaptchaRequired(database, laterFailure + CAPTCHA_WINDOW_MS)).toBe(false)
    }
    finally {
      if (previous === undefined) Bun.env.ENABLE_CAPTCHA_ALWAYS = undefined
      else Bun.env.ENABLE_CAPTCHA_ALWAYS = previous
    }
  })

  test('issues SVG challenges without storing the plaintext answer and consumes them once', () => {
    const database = testDatabase()
    const challenge = issuePasswordCaptcha(database, 1_000)
    expect(challenge.image).toStartWith('data:image/svg+xml;base64,')
    const stored = database.query('SELECT answer_hash FROM password_captcha_challenges WHERE token=?')
      .get(challenge.token) as { answer_hash: string }
    expect(stored.answer_hash).toHaveLength(64)
    expect(consumePasswordCaptcha(database, challenge.token, 'wrong', 2_000)).toBe(false)
    expect(consumePasswordCaptcha(database, challenge.token, 'wrong', 2_000)).toBe(false)
  })
})
