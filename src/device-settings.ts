import type { Database } from 'bun:sqlite'
import { db } from './db'
import { notificationDevice } from './http'

export const PAGE_SIZE_CHOICES = [20, 40, 80, 100] as const
export type PageSizeChoice = typeof PAGE_SIZE_CHOICES[number]
export const DENSITY_CHOICES = ['compact', 'regular', 'relaxed'] as const
export type DensityChoice = typeof DENSITY_CHOICES[number]

export function devicePageSize(request: Request, userId: number | null | undefined,
  database: Database = db): PageSizeChoice
{
  const deviceId = notificationDevice(request)
  if (!userId || !deviceId) return 20
  const row = database.query('SELECT page_size pageSize FROM device_settings WHERE user_id=? AND device_id=?')
    .get(userId, deviceId) as { pageSize: number } | null
  return row && PAGE_SIZE_CHOICES.includes(row.pageSize as PageSizeChoice) ? row.pageSize as PageSizeChoice : 20
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
  database.query(`INSERT INTO device_settings(user_id,device_id,page_size,density) VALUES(?,?,20,?)
    ON CONFLICT(user_id,device_id) DO UPDATE SET density=excluded.density,updated_at=CURRENT_TIMESTAMP`)
    .run(userId, deviceId, density)
}
