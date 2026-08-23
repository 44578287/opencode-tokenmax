// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void

/** Minimal duck-typed EventEmitter double for ProcessLike / ReadableLike in tests. */
export class FakeEmitter {
  private readonly listeners = new Map<string, Set<Listener>>()

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
    return this
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener)
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

export class FakeProcess extends FakeEmitter {
  readonly stdout = new FakeEmitter()
  readonly stderr = new FakeEmitter()
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }
}
