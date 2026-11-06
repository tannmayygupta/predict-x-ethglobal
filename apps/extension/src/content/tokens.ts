import type { Token } from "@predictx/shared";
import { api } from "./api";

const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;

let tokens: Token[] = [];
const listeners = new Set<() => void>();

export const tokenStore = {
  get: (): Token[] => tokens,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Fetches the allowlist, retrying with backoff until the backend answers, so a late-starting backend still works. */
export async function loadTokens(): Promise<Token[]> {
  for (let wait = RETRY_MIN_MS; ; wait = Math.min(wait * 2, RETRY_MAX_MS)) {
    try {
      tokens = await api.tokens();
      for (const listener of listeners) listener();
      return tokens;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
