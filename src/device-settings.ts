import type { Database } from 'bun:sqlite'
import { db } from './db'
import { notificationDevice } from './http'
import { PAGE_SIZE } from './pagination'
import { DENSITY_CHOICES, type DensityChoice, PAGE_SIZE_CHOICES, type PageSizeChoice } from './request-preferences'

export { DENSITY_CHOICES, type DensityChoice, PAGE_SIZE_CHOICES, type PageSizeChoice } from './request-preferences'

export function devicePageSize(_request: Request, _userId: number | null | undefined,
  _database: Database = db): PageSizeChoice
{
  return PAGE_SIZE
}

export function saveDevicePageSize(userId: number, deviceId: string, pageSize: PageSizeChoice,
  database: Database = db)
{
  database.query(`INSERT INTO device_settings(user_id,device_id,page_size) VALUES(?,?,?)
    ON CONFLICT(user_id,device_id) DO UPDATE SET page_size=excluded.page_size,updated_at=CURRENT_TIMESTAMP`)
    .run(userId, deviceId, pageSize)
}

export function deviceDensity(request: Request, userId: number | null | undefined,
  database: Database = db): DensityChoice
{
  const deviceId = notificationDevice(request)
  if (!userId || !deviceId) return 'regular'
  const row = database.query('SELECT density FROM device_settings WHERE user_id=? AND device_id=?')
    .get(userId, deviceId) as { density: string } | null
  return row && DENSITY_CHOICES.includes(row.density as DensityChoice) ? row.density as DensityChoice : 'regular'
}

export function saveDeviceDensity(userId: number, deviceId: string, density: DensityChoice, database: Database = db) {
  database.query(`INSERT INTO device_settings(user_id,device_id,page_size,density) VALUES(?,?,?,?)
    ON CONFLICT(user_id,device_id) DO UPDATE SET density=excluded.density,updated_at=CURRENT_TIMESTAMP`)
    .run(userId, deviceId, PAGE_SIZE, density)
}
