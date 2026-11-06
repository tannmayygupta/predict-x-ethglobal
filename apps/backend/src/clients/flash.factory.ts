import type { Config } from "../config";
import { systemClock, type Clock } from "../util/clock";
import { HttpFlashClient, type FetchLike } from "./flash.http";
import { MockFlashClient } from "./flash.mock";
import type { FlashClient } from "./flash.types";

export interface FlashClientDeps {
  clock?: Clock;
  fetchImpl?: FetchLike;
}

/** Looked up per call so a test-time fetch stub is never captured at import time. */
const liveFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/** Mock versus real is one env var (FLASH_MOCK), read through config only (AGENT.md section 5). */
export function createFlashClient(config: Config, deps: FlashClientDeps = {}): FlashClient {
  const clock = deps.clock ?? systemClock;
  if (config.flashMock) return new MockFlashClient(clock);
  return new HttpFlashClient({
    baseUrl: config.flashBaseUrl,
    apiKey: config.flashApiKey,
    clock,
    fetchImpl: deps.fetchImpl ?? liveFetch,
  });
}
