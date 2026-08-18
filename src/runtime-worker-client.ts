import type { MainToRuntimeMessage, RuntimeToMainMessage, RuntimeWorkerState } from './runtime-worker-protocol'
import type { DatabaseDomainInput, DatabaseDomainOperation, DatabaseDomainOutput } from './database-contract'
import type { DatabaseService } from './database-service'

type PendingRequest = {
  resolve: (response: any) => void
  reject: (error: Error) => void
}

export class DatabaseUnavailableError extends Error {
  readonly retryAfterSeconds: number

  constructor(message = 'Database worker is unavailable', retryAfterSeconds = 1) {
    super(message)
    this.name = 'DatabaseUnavailableError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class RuntimeWorkerClient implements DatabaseService {
  state: RuntimeWorkerState = 'starting'
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private restartDelayMs = 1_000
  private unavailableRetryAfterSeconds = 1
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private generation = 0

  constructor(private workerUrl: URL) {
    this.start(false)
  }

  get retryAfterSeconds() {
    return this.unavailableRetryAfterSeconds
  }

  ready() {
    if (this.state === 'ready') return Promise.resolve()
    return new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }))
  }

  async call<K extends DatabaseDomainOperation>(operation: K,
    input: DatabaseDomainInput<K>): Promise<DatabaseDomainOutput<K>>
  {
    if (this.state !== 'ready' || !this.worker) {
      throw new DatabaseUnavailableError('Database worker is restarting', this.unavailableRetryAfterSeconds)
    }
    const id = this.nextId++
    return await new Promise<DatabaseDomainOutput<K>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker!.postMessage({ type: 'domain', id, operation, input } as MainToRuntimeMessage)
      }
      catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async testControl(action: 'block' | 'crash') {
    if (Bun.env.NODE_ENV !== 'test') throw new Error('Worker controls are test-only')
    if (this.state !== 'ready' || !this.worker) throw new DatabaseUnavailableError()
    const id = this.nextId++
    return await new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker!.postMessage({ type: 'testControl', id, action } satisfies MainToRuntimeMessage)
      }
      catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  terminate() {
    this.generation++
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.worker?.terminate()
    this.worker = null
    this.state = 'unavailable'
    this.failPending(new DatabaseUnavailableError())
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(new DatabaseUnavailableError())
  }

  private start(restarting: boolean) {
    this.state = restarting ? 'restarting' : 'starting'
    const generation = ++this.generation
    const worker = new Worker(this.workerUrl.href)
    this.worker = worker
    worker.onmessage = event => {
      if (generation === this.generation) this.onMessage(event.data as RuntimeToMainMessage)
    }
    worker.onerror = event => {
      console.error('database worker error', event.message)
      this.failed(generation)
    }
    worker.addEventListener('close', () => this.failed(generation))
  }

  private onMessage(message: RuntimeToMainMessage) {
    if (message.type === 'ready') {
      this.state = 'ready'
      this.restartDelayMs = 1_000
      this.unavailableRetryAfterSeconds = 1
      for (const waiter of this.readyWaiters.splice(0)) waiter.resolve()
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (message.type === 'domainResult') {
      pending.resolve(message.result)
      this.pending.delete(message.id)
      return
    }
    else {
      const error = Object.assign(new Error(message.error.message), {
        name: message.error.name, stack: message.error.stack,
      })
      pending.reject(error)
      this.pending.delete(message.id)
    }
  }

  private failed(generation: number) {
    if (generation !== this.generation || this.state === 'unavailable') return
    this.state = 'unavailable'
    this.worker = null
    this.failPending(new DatabaseUnavailableError('Database worker stopped', Math.ceil(this.restartDelayMs / 1_000)))
    const delay = this.restartDelayMs
    this.unavailableRetryAfterSeconds = Math.ceil(delay / 1_000)
    this.restartDelayMs = Math.min(this.restartDelayMs * 2, 30_000)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start(true)
    }, delay)
    this.restartTimer.unref()
  }

  private failPending(error: DatabaseUnavailableError) {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
