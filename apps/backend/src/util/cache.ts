import type { Clock } from "./clock";

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

/** In-memory TTL cache. Stale entries stay readable so callers can serve them when an upstream fails. */
export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlSeconds: number,
  ) {}

  get(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key);
  }

  /** Fresh means strictly inside the window: an entry stored at t expires at t + ttl. */
  isFresh(key: string): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && this.clock.now() < entry.storedAt + this.ttlSeconds;
  }

  getFresh(key: string): T | undefined {
    return this.isFresh(key) ? this.entries.get(key)?.value : undefined;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, storedAt: this.clock.now() });
  }

  size(): number {
    return this.entries.size;
  }
}
