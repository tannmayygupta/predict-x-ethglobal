import type { Market } from "@predictx/shared";
import { STALE_PRICE_SECONDS, startPolling, type ApiClientError } from "@predictx/ui";
import { useEffect, useState } from "react";
import { api } from "../api";

export const MARKET_REFRESH_MS = 30_000;

export interface MarketView {
  market: Market | null;
  error: ApiClientError | null;
  /** True when a refresh failed or the backend is serving an old cached price (copy: "Price delayed"). */
  delayed: boolean;
}

/** Live price for the open card: read now, refresh every 30 s, keep the last good value if a refresh fails. */
export function useMarket(symbol: string, now: number): MarketView & { retry(): void } {
  const [state, setState] = useState<{ market: Market | null; error: ApiClientError | null }>({ market: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState({ market: null, error: null });
    const poller = startPolling(() => api.market(symbol), MARKET_REFRESH_MS, {
      onData: (market) => setState({ market, error: null }),
      onError: (error) => setState((s) => ({ market: s.market, error: error as ApiClientError })),
    });
    return poller.stop;
  }, [symbol, attempt]);

  const delayed = state.market !== null && (state.error !== null || now - state.market.updatedAt > STALE_PRICE_SECONDS);
  return { ...state, delayed, retry: () => setAttempt((n) => n + 1) };
}
