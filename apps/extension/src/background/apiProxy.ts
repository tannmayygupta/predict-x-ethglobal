import type { HttpRequest, HttpResponse } from "@predictx/ui";
import type { ApiReply } from "../messages";

/** Identical GETs within this window share one answer, so many bet boxes cost the backend one request. */
export const GET_CACHE_MS = 3_000;
const ALLOWED_METHODS: ReadonlySet<string> = new Set(["GET", "POST"]);

export interface ApiProxyOptions {
  /** The only place this proxy will ever call, for example http://localhost:8787/api/v1. */
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
 * identical in-flight GETs and keeps successful ones for GET_CACHE_MS.
 */
export function createApiProxy(options: ApiProxyOptions): { handle(request: HttpRequest): Promise<ApiReply> } {
  const root = options.baseUrl.replace(/\/+$/, "");
  const now = options.now ?? Date.now;
  const inflight = new Map<string, Promise<HttpResponse>>();
  const cache = new Map<string, Cached>();

  async function send(request: HttpRequest): Promise<HttpResponse> {
    const res = await options.fetchImpl(request.url, {
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

  function validate(request: HttpRequest): string | null {
    if (!ALLOWED_METHODS.has(request.method)) return "method not allowed";
    if (typeof request.url !== "string" || !request.url.startsWith(`${root}/`)) return "url outside the API base";
    return null;
  }

  return {
    async handle(request) {
      const problem = validate(request);
      if (problem) return { ok: false, error: problem };
      try {
        if (request.method === "POST") return { ok: true, response: await send(request) };
        const hit = cache.get(request.url);
        if (hit && now() - hit.at < GET_CACHE_MS) return { ok: true, response: hit.response };
        let pending = inflight.get(request.url);
        if (!pending) {
          pending = send(request).finally(() => inflight.delete(request.url));
          inflight.set(request.url, pending);
        }
        const response = await pending;
        if (response.status >= 200 && response.status < 300) cache.set(request.url, { at: now(), response });
        return { ok: true, response };
      } catch {
        return { ok: false, error: "network" };
      }
    },
  };
}
