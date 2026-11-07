import type { InsightResponse } from "@predictx/shared";

/** Same as the server's cache: asking again inside this window returns the same tip, so reuse it locally. */
export const INSIGHT_CACHE_TTL_MS = 300_000;

interface Entry {
  insight: InsightResponse;
  intent: string;
  at: number;
}

const store = new Map<string, Entry>();

/** Survives tab switches (the panel unmounts) without a global state library. Keyed by symbol. */
export function readInsight(symbol: string, nowMs: number = Date.now()): Entry | null {
  const hit = store.get(symbol);
  if (!hit) return null;
  if (nowMs - hit.at > INSIGHT_CACHE_TTL_MS) {
    store.delete(symbol);
    return null;
  }
  return hit;
}

export function writeInsight(symbol: string, insight: InsightResponse, intent: string, nowMs: number = Date.now()): void {
  store.set(symbol, { insight, intent, at: nowMs });
}

export function clearInsightCache(): void {
  store.clear();
}
