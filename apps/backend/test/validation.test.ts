import { ApiError, FlashQuoteRequest, InsightRequest, Market, fixtures } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { routeConfig } from "../src/plugins/validation";
import { buildTestApp } from "./helpers/build";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B01-13 body validation", () => {
  it("rejects {} on a route declaring body: InsightRequest with 400 naming symbol", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.post("/v-insight", { config: routeConfig({ body: InsightRequest }) }, async (request) => request.parsed.body);
      },
    });
    const res = await built.app.inject({ method: "POST", url: "/api/v1/v-insight", payload: {} });
    expect(res.statusCode).toBe(400);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("BAD_REQUEST");
    expect(parsed.error.message).toContain("symbol");
  });
});

describe("B01-14 valid body reaches the handler parsed", () => {
  it("applies schema defaults: slippage becomes \"0.01\" for FlashQuoteRequest", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.post("/v-quote", { config: routeConfig({ body: FlashQuoteRequest }) }, async (request) => request.parsed.body);
      },
    });
    const res = await built.app.inject({
      method: "POST",
      url: "/api/v1/v-quote",
      payload: {
        walletAddress: "0x1111111111111111111111111111111111111111",
        symbol: "ETH",
        side: "buy",
        orderType: "market",
        amount: "2.00",
        extra: "stripped",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.slippage).toBe("0.01");
    expect(body).not.toHaveProperty("extra");
  });
});

describe("B01-15 response validation", () => {
  it("turns a body that fails the declared response schema into 500 INTERNAL and logs the zod issue", async () => {
    const logs = new LogCapture();
    built = await buildTestApp({
      logStream: logs,
      extraRoutes: (app) => {
        app.get("/v-market", { config: routeConfig({ response: Market }) }, async () => ({ nope: true }));
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/v-market" });
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error.code).toBe("INTERNAL");
    const line = logs.entries().find((e) => e.msg === "response validation failed");
    expect(line).toBeDefined();
    expect(line?.level).toBe(50);
    expect(JSON.stringify(line?.issues)).toContain("symbol");
  });
  it("passes a valid body through unchanged", async () => {
    built = await buildTestApp({
      extraRoutes: (app) => {
        app.get("/v-market-ok", { config: routeConfig({ response: Market }) }, async () => fixtures.marketEth);
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/v-market-ok" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fixtures.marketEth);
  });
  it("is skipped when VALIDATE_RESPONSES=false (prod switch, D-B8)", async () => {
    built = await buildTestApp({
      env: { VALIDATE_RESPONSES: "false" },
      extraRoutes: (app) => {
        app.get("/v-market", { config: routeConfig({ response: Market }) }, async () => ({ nope: true }));
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/v-market" });
    expect(res.statusCode).toBe(200);
  });
});
