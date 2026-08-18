export type RuntimeWorkerState = 'starting' | 'ready' | 'unavailable' | 'restarting'

export type MainToRuntimeMessage =
  | { type: 'domain'; id: number; operation: DatabaseDomainOperation; input: DatabaseDomainInput<DatabaseDomainOperation>;
    priority?: 'foreground' | 'background' }
  | { type: 'testControl'; id: number; action: 'block' | 'crash' }

export type RuntimeError = { name: string; message: string; stack?: string }

export type RuntimeToMainMessage =
  | { type: 'ready' }
  | { type: 'domainResult'; id: number; result: DatabaseDomainOutput<DatabaseDomainOperation> }
  | { type: 'error'; id: number; error: RuntimeError }
import type { DatabaseDomainInput, DatabaseDomainOperation, DatabaseDomainOutput } from './database-contract'
