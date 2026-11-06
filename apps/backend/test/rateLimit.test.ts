import { ApiError } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { routeConfig } from "../src/plugins/validation";
import { buildTestApp } from "./helpers/build";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const DEFAULT_LIMIT = 60;
// TEST_PLAN B01-19 counts GET /tokens; T-B02 re-pointed this from /health once the route existed.
const DEFAULT_ROUTE = "/api/v1/tokens";

async function hit(app: Built["app"], url: string, times: number, ip = "127.0.0.1", method: "GET" | "POST" = "GET") {
  let last = 0;
  for (let i = 0; i < times; i += 1) {
    const res = await app.inject({ method, url, remoteAddress: ip, ...(method === "POST" ? { payload: {} } : {}) });
    last = res.statusCode;
  }
  return last;
}

describe("B01-19 default bucket 60 per minute", () => {
  it("the 60th request from one IP returns 200 and the 61st returns 429 RATE_LIMITED", async () => {
    built = await buildTestApp();
    expect(await hit(built.app, DEFAULT_ROUTE, DEFAULT_LIMIT)).toBe(200);
    const res = await built.app.inject({ method: "GET", url: DEFAULT_ROUTE });
    expect(res.statusCode).toBe(429);
    expect(ApiError.parse(res.json()).error.code).toBe("RATE_LIMITED");
  });
});

const INSIGHT_LIMIT = 10;
// The real /insight route is filled by T-B05; a throwaway route carries the same bucket config.
const INSIGHT_ROUTE = "/api/v1/insight-limited";

function withInsightRoute() {
  return buildTestApp({
    extraRoutes: (app) => {
      app.post("/insight-limited", { config: routeConfig({ rateLimit: "insight" }) }, async () => ({ ok: true }));
    },
  });
}

describe("B01-20 insight bucket 10 per minute", () => {
  it("the 10th POST from one IP passes and the 11th returns 429", async () => {
    built = await withInsightRoute();
    expect(await hit(built.app, INSIGHT_ROUTE, INSIGHT_LIMIT, "127.0.0.1", "POST")).toBe(200);
    const res = await built.app.inject({ method: "POST", url: INSIGHT_ROUTE, payload: {} });
    expect(res.statusCode).toBe(429);
    expect(ApiError.parse(res.json()).error.code).toBe("RATE_LIMITED");
  });
  it("an exhausted default bucket leaves the insight bucket of the same IP untouched", async () => {
    built = await withInsightRoute();
    expect(await hit(built.app, DEFAULT_ROUTE, DEFAULT_LIMIT)).toBe(200);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(429);
    expect(await hit(built.app, INSIGHT_ROUTE, 1, "127.0.0.1", "POST")).toBe(200);
  });
  it("an exhausted insight bucket leaves the default bucket of the same IP untouched", async () => {
    built = await withInsightRoute();
    expect(await hit(built.app, INSIGHT_ROUTE, INSIGHT_LIMIT, "127.0.0.1", "POST")).toBe(200);
    expect(await hit(built.app, INSIGHT_ROUTE, 1, "127.0.0.1", "POST")).toBe(429);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(200);
  });
});

describe("B01-21 limits are per IP", () => {
  it("a second remoteAddress is not affected by the first IP's exhausted count", async () => {
    built = await buildTestApp();
    await hit(built.app, DEFAULT_ROUTE, DEFAULT_LIMIT + 1, "203.0.113.9");
    expect(await hit(built.app, DEFAULT_ROUTE, 1, "203.0.113.9")).toBe(429);
    expect(await hit(built.app, DEFAULT_ROUTE, 1, "198.51.100.7")).toBe(200);
  });
  it("with TRUST_PROXY=1 keys on the address the proxy appended, so a spoofed leftmost value buys nothing (B10-09)", async () => {
    built = await buildTestApp({ env: { TRUST_PROXY: "1" } });
    // inject's remoteAddress (127.0.0.1) plays the proxy; it appended the real client 2.2.2.2 last.
    const proxied = (spoofed: string, client = "2.2.2.2") =>
      built?.app.inject({ method: "GET", url: DEFAULT_ROUTE, headers: { "x-forwarded-for": `${spoofed}, ${client}` } });
    for (let i = 0; i < DEFAULT_LIMIT; i += 1) expect((await proxied(`1.1.1.${i % 250}`))?.statusCode).toBe(200);
    expect((await proxied("1.1.1.1"))?.statusCode).toBe(429);
    expect((await proxied("9.9.9.9"))?.statusCode).toBe(429);
    expect((await proxied("1.1.1.1", "3.3.3.3"))?.statusCode).toBe(200);
  });
  it("ignores x-forwarded-for when TRUST_PROXY is off, so a spoofed header cannot buy a fresh budget (B10-09)", async () => {
    built = await buildTestApp();
    const spoofed = (ip: string) =>
      built?.app.inject({ method: "GET", url: DEFAULT_ROUTE, headers: { "x-forwarded-for": ip } });
    // Every request arrives from the same socket address; the header rotates and must not matter.
    for (let i = 0; i < DEFAULT_LIMIT; i += 1) await spoofed(`203.0.113.${i % 250}`);
    expect((await spoofed("198.51.100.7"))?.statusCode).toBe(429);
    expect(ApiError.parse((await spoofed("198.51.100.8"))?.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("B01-22 window reset", () => {
  it("allows requests again once the injected clock passes 60 s, with no real sleeping", async () => {
    built = await buildTestApp();
    await hit(built.app, DEFAULT_ROUTE, DEFAULT_LIMIT);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(429);
    built.clock.advance(59);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(429);
    built.clock.advance(1);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(200);
    // The new window starts fresh: a full budget is available again.
    expect(await hit(built.app, DEFAULT_ROUTE, DEFAULT_LIMIT - 1)).toBe(200);
    expect(await hit(built.app, DEFAULT_ROUTE, 1)).toBe(429);
  });
});
