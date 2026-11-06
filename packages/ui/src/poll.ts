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
 * Reads immediately, then again `intervalMs` after each read finishes, so reads never overlap and a slow
 * server is not hammered. A result that arrives after stop() is dropped.
 */
export function startPolling<T>(read: () => Promise<T>, intervalMs: number, handlers: PollHandlers<T>): Poller {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    clearTimeout(timer);
    try {
      const value = await read();
      if (!stopped) handlers.onData(value);
    } catch (err) {
      if (!stopped) handlers.onError(err);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  void tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    refresh() {
      void tick();
    },
  };
}
