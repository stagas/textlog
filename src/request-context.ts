import { AsyncLocalStorage } from 'node:async_hooks'
import type { DensityChoice, PageSizeChoice } from './request-preferences'
import type { User } from './types'

export type RequestContextState = {
  sessionUser: User | null
  apiUser: User | null
  pageSize: PageSizeChoice
  density: DensityChoice
}

const storage = new AsyncLocalStorage<RequestContextState>()

export function withRequestContext<T>(state: RequestContextState, callback: () => T): T {
  return storage.run(state, callback)
}

export function requestContext() {
  return storage.getStore()
}
