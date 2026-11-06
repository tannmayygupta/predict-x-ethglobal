export interface Poller {
  stop(): void;
  /** Reads now (for example right after a transaction) instead of waiting for the next tick. */
  refresh(): void;
}

export interface PollHandlers<T> {
  onData(value: T): void;
  onError(error: unknown): void;
}

/**
 * Reads immediately, then again `intervalMs` after each read finishes, so reads never overlap and a slow server is
 * not hammered. A result that arrives after stop() is dropped.
 *
 * refresh() is never lost: if a read is already in flight, that read started before the change that prompted the
 * refresh, so its answer is stale. It is discarded and a new read runs straight after it finishes.
 */
export function startPolling<T>(read: () => Promise<T>, intervalMs: number, handlers: PollHandlers<T>): Poller {
  let stopped = false;
  let running = false;
  let rerun = false;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    rerun = false;
    clearTimeout(timer);
    const startedIn = epoch;
    try {
      const value = await read();
      if (!stopped && startedIn === epoch) handlers.onData(value);
    } catch (err) {
      if (!stopped && startedIn === epoch) handlers.onError(err);
    } finally {
      running = false;
      if (!stopped) {
        if (rerun) void tick();
        else timer = setTimeout(() => void tick(), intervalMs);
      }
    }
  };

  void tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    refresh() {
      if (stopped) return;
      epoch += 1;
      if (running) rerun = true;
      else void tick();
    },
  };
}
