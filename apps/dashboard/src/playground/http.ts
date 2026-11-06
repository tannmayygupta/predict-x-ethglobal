import type { HttpMethod } from "./endpoints";

const TIMEOUT_MS = 15_000;
export const SLOW_MS = 2_000;

export interface RequestResult {
  id: string;
  at: number;
  method: HttpMethod;
  path: string;
  /** null when no HTTP response arrived (network error or timeout). */
  status: number | null;
  statusText: string;
  ms: number;
  bytes: number;
  /** Pretty JSON when the body parses, raw text otherwise. Untrusted: render as text only. */
  body: string;
}

export const isSuccess = (r: RequestResult): boolean => r.status !== null && r.status >= 200 && r.status < 300;

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function prettify(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

let counter = 0;

/** Never throws: every failure becomes a result with status null and a readable message in `body`. */
export async function sendRequest(baseUrl: string, method: HttpMethod, path: string, jsonBody?: string): Promise<RequestResult> {
  const started = performance.now();
  const base = { id: `${Date.now()}-${counter++}`, at: Date.now(), method, path };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const init: RequestInit = { method, signal: controller.signal };
    if (method === "POST") {
      init.headers = { "content-type": "application/json" };
      init.body = jsonBody ?? "";
    }
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    return { ...base, status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - started), bytes: new TextEncoder().encode(text).length, body: prettify(text) };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const message = timedOut
      ? `No response within ${TIMEOUT_MS / 1000} s. The request was cancelled.`
      : `Could not reach ${baseUrl}. Check that the backend is running and that CORS allows this origin.`;
    return { ...base, status: null, statusText: "Network error", ms: Math.round(performance.now() - started), bytes: 0, body: message };
  } finally {
    clearTimeout(timer);
  }
}
