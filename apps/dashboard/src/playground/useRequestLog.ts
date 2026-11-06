import { useCallback, useState } from "react";
import type { RequestResult } from "./http";

const MAX_ENTRIES = 50;

/** In-memory request log, newest first, capped so a long session cannot grow without bound. */
export function useRequestLog() {
  const [entries, setEntries] = useState<RequestResult[]>([]);
  const add = useCallback((entry: RequestResult) => setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES)), []);
  const clear = useCallback(() => setEntries([]), []);
  return { entries, add, clear };
}
