import type { HttpRequest, HttpResponse } from "@predictx/ui/core";
import type { ApiReply } from "../messages";

/** Identical GETs within this window share one answer, so many bet boxes cost the backend one request. */
export const GET_CACHE_MS = 3_000;
/** Distinct GET URLs kept at once (for example one position per wallet per pool); the oldest go first. */
export const MAX_CACHED_URLS = 200;
const ALLOWED_METHODS: ReadonlySet<string> = new Set(["GET", "POST"]);

export interface ApiProxyOptions {
  /** The only place this proxy will ever call, for example https://example.test/api/v1. */
  baseUrl: string;
  fetchImpl: typeof fetch;
  now?: () => number;
}

interface Cached {
  at: number;
  response: HttpResponse;
}

/**
 * The service worker's backend gateway. It is deliberately not a generic proxy: the URL must sit under the
 * configured API base, the method must be GET or POST, and only successful GETs are cached. It coalesces
 * identical in-flight GETs and keeps successful ones for GET_CACHE_MS, up to MAX_CACHED_URLS of them.
 */
export function createApiProxy(options: ApiProxyOptions): { handle(request: HttpRequest): Promise<ApiReply> } {
  // Trailing slash so "/api/v1" cannot also match "/api/v1evil".
  const base = new URL(`${options.baseUrl.replace(/\/+$/, "")}/`);
  const now = options.now ?? Date.now;
  const inflight = new Map<string, Promise<HttpResponse>>();
  const cache = new Map<string, Cached>();

  async function send(url: string, request: HttpRequest): Promise<HttpResponse> {
    const res = await options.fetchImpl(url, {
      method: request.method,
      ...(request.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) }),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  /**
   * The check runs on the parsed URL, because that is what fetch will actually request: "/api/v1/../admin" and
   * "%2e%2e" both normalise to a path outside the base and are refused. Returns the normalised URL or a reason.
   */
  function validate(request: HttpRequest): { url: string } | { problem: string } {
    if (!ALLOWED_METHODS.has(request.method)) return { problem: "method not allowed" };
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { problem: "invalid url" };
    }
    if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(base.pathname)) {
      return { problem: "url outside the API base" };
    }
    return { url: url.href };
  }

  function remember(url: string, response: HttpResponse): void {
    cache.delete(url);
    cache.set(url, { at: now(), response });
    if (cache.size <= MAX_CACHED_URLS) return;
    for (const [key, entry] of cache) if (now() - entry.at >= GET_CACHE_MS) cache.delete(key);
    while (cache.size > MAX_CACHED_URLS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  return {
    async handle(request) {
      const checked = validate(request);
      if ("problem" in checked) return { ok: false, error: checked.problem };
      const { url } = checked;
      try {
        if (request.method === "POST") return { ok: true, response: await send(url, request) };
        const hit = cache.get(url);
        if (hit && now() - hit.at < GET_CACHE_MS) return { ok: true, response: hit.response };
        let pending = inflight.get(url);
        if (!pending) {
          pending = send(url, request).finally(() => inflight.delete(url));
          inflight.set(url, pending);
        }
        const response = await pending;
        if (response.status >= 200 && response.status < 300) remember(url, response);
        return { ok: true, response };
      } catch {
        return { ok: false, error: "network" };
      }
    },
  };
}
