import type { ChartRange, MarketChart } from "@predictx/shared";
import { useEffect, useState } from "react";
import type { ApiClient, ApiClientError } from "../api";
import { startPolling } from "../poll";

/** Matches the backend's 24h cache TTL: asking more often only returns the same series. */
export const CHART_REFRESH_MS = 300_000;

export interface ChartView {
  chart: MarketChart | null;
  /** True until the first answer (data or error) arrives. */
  loading: boolean;
  error: ApiClientError | null;
  /** A refresh failed but an older series is still on screen. */
  stale: boolean;
  retry(): void;
}

interface State {
  chart: MarketChart | null;
  error: ApiClientError | null;
  loading: boolean;
}

/** Price series for the chart: read now, refresh every 5 min, keep the last good series if a refresh fails. */
export function useMarketChart(api: ApiClient, symbol: string, range: ChartRange): ChartView {
  const [state, setState] = useState<State>({ chart: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState({ chart: null, error: null, loading: true });
    const poller = startPolling(() => api.chart(symbol, range), CHART_REFRESH_MS, {
      onData: (chart) => setState({ chart, error: null, loading: false }),
      onError: (error) => setState((s) => ({ chart: s.chart, error: error as ApiClientError, loading: false })),
    });
    return poller.stop;
  }, [api, symbol, range, attempt]);

  return { ...state, stale: state.chart !== null && state.error !== null, retry: () => setAttempt((n) => n + 1) };
}
