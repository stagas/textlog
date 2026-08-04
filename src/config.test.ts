import { describe, expect, test } from 'bun:test'
import { ConfigurationError, validateStartupConfiguration } from './config'

const production = {
  NODE_ENV: 'production',
  APP_URL: 'https://root.mx',
  RESEND_API_KEY: 'configured-secret',
  EMAIL_FROM: 'root.mx <hello@root.mx>',
  OPENAI_API_KEY: 'configured-secret',
  IP_PSEUDONYM_SECRET: 'configured-secret-at-least-32-characters',
}

describe('startup configuration', () => {
  test('accepts a complete production configuration and normalizes its public origin', () => {
    const config = validateStartupConfiguration({ ...production, APP_URL: 'https://root.mx/' }, {
      checkFilesystem: false,
    })

    expect(config).toMatchObject({ production: true, appUrl: 'https://root.mx', host: '0.0.0.0', port: 3000,
      databaseBusyTimeoutMs: 5000, backupRetentionDays: 14, moderationDisabled: false })
  })

  test('reports all missing production integrations without exposing values', () => {
    expect(() => validateStartupConfiguration({ NODE_ENV: 'production' }, { checkFilesystem: false }))
      .toThrow(ConfigurationError)
    try {
      validateStartupConfiguration({ NODE_ENV: 'production' }, { checkFilesystem: false })
    }
    catch (error) {
      const message = String(error)
      expect(message).toContain('APP_URL is required')
      expect(message).toContain('RESEND_API_KEY is required')
      expect(message).toContain('EMAIL_FROM is required')
      expect(message).toContain('OPENAI_API_KEY is required')
      expect(message).toContain('IP_PSEUDONYM_SECRET must be at least 32 characters')
    }
  })

  test('rejects unsafe URLs, conflicting modes, malformed booleans, and invalid numeric settings', () => {
    expect(() =>
      validateStartupConfiguration({
        ...production,
        APP_URL: 'http://user:pass@root.mx/private?token=secret',
        DEV_RELOAD: 'true',
        TRUST_PROXY: 'sometimes',
        PORT: '70000',
        DATABASE_BUSY_TIMEOUT_MS: '60000',
        DATABASE_BACKUP_RETENTION_DAYS: '0',
      }, { checkFilesystem: false })
    ).toThrow('Invalid startup configuration')
  })

  test('keeps integrations optional in development but rejects partial email configuration', () => {
    expect(validateStartupConfiguration({ NODE_ENV: 'development' }, { checkFilesystem: false }))
      .toMatchObject({ production: false, appUrl: null })
    expect(() =>
      validateStartupConfiguration({ NODE_ENV: 'development', RESEND_API_KEY: 'only-one' }, {
        checkFilesystem: false,
      })
    ).toThrow('RESEND_API_KEY and EMAIL_FROM must be configured together')
  })

  test('allows captured email only in isolated tests', () => {
    expect(validateStartupConfiguration({ NODE_ENV: 'test', EMAIL_CAPTURE_PATH: '/tmp/root-mx-mail.jsonl' }, {
      checkFilesystem: false,
    }).environment).toBe('test')
    expect(() =>
      validateStartupConfiguration({
        NODE_ENV: 'development',
        EMAIL_CAPTURE_PATH: '/tmp/root-mx-mail.jsonl',
      }, { checkFilesystem: false })
    ).toThrow('EMAIL_CAPTURE_PATH is only allowed in test')
    expect(() =>
      validateStartupConfiguration({
        NODE_ENV: 'test',
        EMAIL_CAPTURE_PATH: '/tmp/root-mx-mail.jsonl',
        RESEND_API_KEY: 'configured-secret',
        EMAIL_FROM: 'root.mx <hello@root.mx>',
      }, { checkFilesystem: false })
    ).toThrow('EMAIL_CAPTURE_PATH cannot be combined')
  })

  test('allows an explicit production moderation bypass', () => {
    const { OPENAI_API_KEY: _, ...withoutModerationKey } = production
    expect(validateStartupConfiguration({ ...withoutModerationKey, MODERATION_DISABLED: 'true' }, {
      checkFilesystem: false,
    }).moderationDisabled).toBe(true)
  })
})
