import type { DatabaseDomainInput, DatabaseDomainOperation, DatabaseDomainOutput } from './database-contract'

export interface DatabaseService {
  call<K extends DatabaseDomainOperation>(operation: K, input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
  callBackground?<K extends DatabaseDomainOperation>(operation: K,
    input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
}

let configuredService: DatabaseService | null = null

export function configureDatabaseService(service: DatabaseService) {
  configuredService = service
}

export function databaseService(): DatabaseService {
  if (!configuredService) throw new Error('Database service has not been configured')
  return configuredService
}

export function backgroundDatabaseCall<K extends DatabaseDomainOperation>(operation: K, input: DatabaseDomainInput<K>) {
  const service = databaseService()
  return service.callBackground ? service.callBackground(operation, input) : service.call(operation, input)
}
