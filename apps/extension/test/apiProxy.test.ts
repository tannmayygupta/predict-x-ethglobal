import { describe, expect, it, vi } from "vitest";
import { GET_CACHE_MS, createApiProxy } from "../src/background/apiProxy";

const BASE = "http://localhost:8787/api/v1";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function proxy(fetchImpl: typeof fetch, clock = { t: 0 }) {
  return { proxy: createApiProxy({ baseUrl: `${BASE}/`, fetchImpl, now: () => clock.t }), clock };
}

describe("api proxy gateway", () => {
  it("refuses any URL outside the configured API base (it is not an open proxy)", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { proxy: p } = proxy(fetchImpl);
    for (const url of ["https://evil.example/steal", "http://localhost:8787/other", "http://localhost:8787/api/v1evil/x", `${BASE}`]) {
      expect(await p.handle({ method: "GET", url })).toMatchObject({ ok: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses methods other than GET and POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { proxy: p } = proxy(fetchImpl);
    const res = await p.handle({ method: "DELETE" as "GET", url: `${BASE}/pools` });
    expect(res).toEqual({ ok: false, error: "method not allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns status and parsed JSON, including error statuses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(404, { error: { code: "NOT_FOUND", message: "x" } }));
    const { proxy: p } = proxy(fetchImpl);
    expect(await p.handle({ method: "GET", url: `${BASE}/pools/9` })).toEqual({
      ok: true, response: { status: 404, body: { error: { code: "NOT_FOUND", message: "x" } } },
    });
  });

  it("coalesces identical GETs that are in flight into one request", async () => {
    let release: () => void = () => undefined;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise((resolve) => { release = () => resolve(reply(200, { ok: 1 })); }));
    const { proxy: p } = proxy(fetchImpl);
    const calls = [1, 2, 3].map(() => p.handle({ method: "GET", url: `${BASE}/pools/1` }));
    await Promise.resolve();
    release();
    const results = await Promise.all(calls);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("serves a successful GET from cache for a few seconds, then asks again", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, { n: 1 }));
    const { proxy: p, clock } = proxy(fetchImpl);
    const req = { method: "GET", url: `${BASE}/market/ETH` } as const;
    await p.handle(req);
    clock.t += GET_CACHE_MS - 1;
    await p.handle(req);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.t += 2;
    await p.handle(req);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never caches failures or POSTs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(500, { error: { code: "INTERNAL", message: "x" } }));
    const { proxy: p } = proxy(fetchImpl);
    await p.handle({ method: "GET", url: `${BASE}/pools` });
    await p.handle({ method: "GET", url: `${BASE}/pools` });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await p.handle({ method: "POST", url: `${BASE}/insight`, body: { symbol: "ETH" } });
    await p.handle({ method: "POST", url: `${BASE}/insight`, body: { symbol: "ETH" } });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("sends POST bodies as JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, {}));
    const { proxy: p } = proxy(fetchImpl);
    await p.handle({ method: "POST", url: `${BASE}/insight`, body: { symbol: "ETH" } });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/insight`, {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"symbol":"ETH"}',
    });
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const { proxy: p } = proxy(fetchImpl);
    expect(await p.handle({ method: "GET", url: `${BASE}/pools` })).toEqual({ ok: false, error: "network" });
  });
});
