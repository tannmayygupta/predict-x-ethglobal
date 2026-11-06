import type { Token } from "@predictx/shared";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api";

const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;

/** The token allowlist, retried with backoff so a backend that starts late still fills the screen. */
export function useTokens(api: ApiClient): Token[] {
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (wait: number): void => {
      api.tokens().then(
        (list) => { if (live) setTokens(list); },
        () => { if (live) timer = setTimeout(() => load(Math.min(wait * 2, RETRY_MAX_MS)), wait); },
      );
    };
    load(RETRY_MIN_MS);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [api]);
  return tokens;
}
