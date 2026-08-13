import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { devicePageSize, saveDevicePageSize } from './device-settings'

function database() {
  const database = new Database(':memory:', { strict: true })
  database.run(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE device_settings(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,page_size INTEGER NOT NULL DEFAULT 20,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,device_id));
    INSERT INTO users(id) VALUES(1),(2);`)
  return database
}

test('page size is stored per user and notification device', () => {
  const db = database()
  const deviceId = 'device_abcdefghijklmnopqrst'
  const request = new Request('http://localhost', { headers: { cookie: `notification_device=${deviceId}` } })
  expect(devicePageSize(request, 1, db)).toBe(20)
  saveDevicePageSize(1, deviceId, 80, db)
  expect(devicePageSize(request, 1, db)).toBe(80)
  expect(devicePageSize(request, 2, db)).toBe(20)
  expect(devicePageSize(new Request('http://localhost'), 1, db)).toBe(20)
})
