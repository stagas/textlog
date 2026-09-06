const DEFAULT_IDLE_MS = 2_000

export class IdleWorkScheduler {
  private validAddresses = new Set<string>()
  private lastActivityAt = 0
  private generation = 0

  constructor(private idleMs = DEFAULT_IDLE_MS, private now = () => Date.now()) {}

  postpone() {
    this.lastActivityAt = this.now()
    this.generation++
  }

  record(address: string | null, qualifies = false) {
    if (!address) return
    if (qualifies) this.validAddresses.add(address)
    if (this.validAddresses.has(address)) this.postpone()
  }

  async waitUntilIdle() {
    while (true) {
      const remaining = this.lastActivityAt + this.idleMs - this.now()
      if (remaining <= 0) return
      const generation = this.generation
      await new Promise(resolve => setTimeout(resolve, remaining))
      if (generation === this.generation && this.now() >= this.lastActivityAt + this.idleMs) return
    }
  }
}

export const feedWarmIdle = new IdleWorkScheduler()
