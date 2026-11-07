/** Concurrent callers with the same key share one in-flight promise, so a cold cache costs one upstream call. */
export class SingleFlight<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const started = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }
}
