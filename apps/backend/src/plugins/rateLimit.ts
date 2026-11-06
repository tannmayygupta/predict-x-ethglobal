import type { App } from "../appTypes";
import { rateLimited } from "../errors";
import type { Clock } from "../util/clock";

/** Routes opt into the stricter bucket with `config.rateLimit = "insight"`; everything else is "default". */
export type RateLimitBucket = "insight";
type Bucket = RateLimitBucket | "default";

/** Per-IP limits per minute from API_CONTRACT.md section 1. */
const LIMITS: Record<Bucket, number> = { default: 60, insight: 10 };
const WINDOW_SECONDS = 60;

export interface RateLimitOptions {
  clock: Clock;
}

interface Window {
  startedAt: number;
  count: number;
}

/** Own implementation (no @fastify/rate-limit): the injected clock lets tests roll the window without sleeping. */
export function registerRateLimit(app: App, options: RateLimitOptions): void {
  const windows = new Map<string, Window>();
  app.addHook("onRequest", async (request) => {
    const bucket: Bucket = request.routeOptions.config.rateLimit ?? "default";
    const key = `${bucket}:${request.ip}`;
    const now = options.clock.now();
    const current = windows.get(key);
    // Fixed window: the first request after expiry opens a fresh one with a full budget.
    const window = current && now < current.startedAt + WINDOW_SECONDS ? current : { startedAt: now, count: 0 };
    window.count += 1;
    windows.set(key, window);
    if (window.count > LIMITS[bucket]) throw rateLimited("Too many requests");
  });
}
