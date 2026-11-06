import { ApiError, InsightResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { InsightModelError } from "../src/clients/insightModel";
import { NotConfiguredInsightModel, OpenAiInsightModel, createInsightModel } from "../src/clients/openai";
import { loadConfig } from "../src/config";
import { buildTestApp } from "./helpers/build";
import { envWith } from "./helpers/env";
import { FakeInsightModel } from "./helpers/fakes/insightModel";
import { FakePriceSource } from "./helpers/fakes/priceSource";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const DRAFT_REPLY = {
  tip: "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  bias: "neutral",
  confidence: "low",
  suggestedLimit: { side: "buy", priceUsd: "2380.00", reason: "About 3% below spot" },
};
const CACHE_TTL_SECONDS = 300;

function pricedSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
  source.prices.bitcoin = { usd: 81269, usd24hChange: 0.5 };
  return source;
}

async function postInsight(app: Built["app"], payload: Record<string, unknown> = { symbol: "ETH" }, ip = "127.0.0.1") {
  return app.inject({ method: "POST", url: "/api/v1/insight", payload, remoteAddress: ip });
}

/** The cache lives in the insights table only (FR-B-05); tests read it straight from SQLite. */
function cacheRows(db: Built["db"]): Array<{ key: string; expires_at: number }> {
  return db.prepare("SELECT key, expires_at FROM insights ORDER BY key").all() as Array<{ key: string; expires_at: number }>;
}

describe("B05-16 two identical requests within 5 minutes", () => {
  it("call the model once; the second is served from the insights table", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const payload = { symbol: "ETH", userIntent: "buy the dip" };
    const first = await postInsight(built.app, payload);
    expect(first.statusCode).toBe(200);
    expect(cacheRows(built.db)).toHaveLength(1);
    const second = await postInsight(built.app, payload);
    expect(second.statusCode).toBe(200);
    expect(InsightResponse.parse(second.json())).toEqual(InsightResponse.parse(first.json()));
    expect(insightModel.calls).toHaveLength(1);
  });
});

describe("B05-17 cache key = symbol + normalised intent", () => {
  it("trims and lower-cases the intent and upper-cases the symbol, so equivalent requests share one entry", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    await postInsight(built.app, { symbol: "ETH", userIntent: "  Buy The Dip " });
    await postInsight(built.app, { symbol: "eth", userIntent: "buy the dip" });
    expect(insightModel.calls).toHaveLength(1);
    expect(cacheRows(built.db).map((r) => r.key)).toEqual(["ETH:buy the dip"]);
  });

  it("different intents and different symbols are different model calls", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    insightModel.queue(DRAFT_REPLY);
    insightModel.queue({ ...DRAFT_REPLY, suggestedLimit: null });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    await postInsight(built.app, { symbol: "ETH", userIntent: "buy the dip" });
    await postInsight(built.app, { symbol: "ETH", userIntent: "sell half" });
    await postInsight(built.app, { symbol: "BTC", userIntent: "buy the dip" });
    expect(insightModel.calls).toHaveLength(3);
    expect(cacheRows(built.db).map((r) => r.key)).toEqual(["BTC:buy the dip", "ETH:buy the dip", "ETH:sell half"]);
  });

  it("a missing, empty and whitespace-only intent all share the symbol-only entry", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    await postInsight(built.app, { symbol: "ETH" });
    await postInsight(built.app, { symbol: "ETH", userIntent: "" });
    await postInsight(built.app, { symbol: "ETH", userIntent: "   " });
    expect(insightModel.calls).toHaveLength(1);
    expect(cacheRows(built.db).map((r) => r.key)).toEqual(["ETH:"]);
  });
});

describe("B05-18 a degraded response is not cached", () => {
  it("recovers on the very next request once the model answers again", async () => {
    const insightModel = new FakeInsightModel();
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const degraded = await postInsight(built.app);
    expect(InsightResponse.parse(degraded.json()).degraded).toBe(true);
    expect(cacheRows(built.db)).toEqual([]);
    insightModel.queue(DRAFT_REPLY);
    const live = await postInsight(built.app);
    expect(InsightResponse.parse(live.json()).degraded).toBe(false);
    expect(insightModel.calls).toHaveLength(3);
    expect(cacheRows(built.db)).toHaveLength(1);
  });
});

describe("B05-19 cache entry expires at +300 s", () => {
  it("is served at +299 s and refreshed from the model at +300 s", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    insightModel.queue({ ...DRAFT_REPLY, tip: "fresh tip" });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const storedAt = built.clock.now();
    await postInsight(built.app);
    expect(cacheRows(built.db)[0]?.expires_at).toBe(storedAt + CACHE_TTL_SECONDS);
    built.clock.advance(CACHE_TTL_SECONDS - 1);
    expect(InsightResponse.parse((await postInsight(built.app)).json()).tip).toBe(DRAFT_REPLY.tip);
    expect(insightModel.calls).toHaveLength(1);
    built.clock.advance(1);
    expect(InsightResponse.parse((await postInsight(built.app)).json()).tip).toBe("fresh tip");
    expect(insightModel.calls).toHaveLength(2);
    expect(cacheRows(built.db)).toEqual([{ key: "ETH:", expires_at: storedAt + 2 * CACHE_TTL_SECONDS }]);
  });
});

describe("B05-19b expired rows are purged", () => {
  it("an expired ETH row disappears when a later insight is stored", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    insightModel.queue({ ...DRAFT_REPLY, suggestedLimit: null });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    await postInsight(built.app, { symbol: "ETH" });
    built.clock.advance(CACHE_TTL_SECONDS);
    await postInsight(built.app, { symbol: "BTC" });
    expect(cacheRows(built.db).map((r) => r.key)).toEqual(["BTC:"]);
  });
});

describe("B05-20 unknown symbol", () => {
  it("returns 400 UNSUPPORTED_TOKEN before the price source or the model is touched", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    const priceSource = pricedSource();
    built = await buildTestApp({ insightModel, priceSource });
    const res = await postInsight(built.app, { symbol: "DOGE" });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("UNSUPPORTED_TOKEN");
    expect(insightModel.calls).toEqual([]);
    expect(priceSource.calls).toEqual([]);
    expect(cacheRows(built.db)).toEqual([]);
  });
});

const INSIGHT_LIMIT_PER_MINUTE = 10;

describe("B05-21 the real /insight route carries the 10 per minute bucket", () => {
  it("the 10th request from one IP passes, the 11th is 429 RATE_LIMITED, another IP is unaffected", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    let last = 0;
    for (let i = 0; i < INSIGHT_LIMIT_PER_MINUTE; i += 1) last = (await postInsight(built.app, { symbol: "ETH" }, "203.0.113.9")).statusCode;
    expect(last).toBe(200);
    const blocked = await postInsight(built.app, { symbol: "ETH" }, "203.0.113.9");
    expect(blocked.statusCode).toBe(429);
    expect(ApiError.parse(blocked.json()).error.code).toBe("RATE_LIMITED");
    expect((await postInsight(built.app, { symbol: "ETH" }, "198.51.100.7")).statusCode).toBe(200);
    // Served from cache after the first call: the limit is on requests, not model calls.
    expect(insightModel.calls).toHaveLength(1);
  });
});

describe("FR-B-03 the service applies clampSuggestedLimit to the model's price (spot 2451.12)", () => {
  it.each([
    ["1000.00", "2083.45"],
    ["9999.00", "2818.79"],
    ["2380.00", "2380.00"],
  ])("a model limit of %s is served as %s", async (modelPrice, served) => {
    const insightModel = new FakeInsightModel();
    insightModel.queue({ ...DRAFT_REPLY, suggestedLimit: { side: "buy", priceUsd: modelPrice, reason: "model said so" } });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const body = InsightResponse.parse((await postInsight(built.app)).json());
    expect(body.suggestedLimit).toEqual({ side: "buy", priceUsd: served, reason: "model said so" });
    expect(body.degraded).toBe(false);
  });

  it("a null suggestedLimit from the model stays null", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue({ ...DRAFT_REPLY, suggestedLimit: null });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    expect(InsightResponse.parse((await postInsight(built.app)).json()).suggestedLimit).toBeNull();
  });
});

describe("createInsightModel wiring (FR-I-03: the tab works with the LLM disabled)", () => {
  it("an empty OPENAI_API_KEY or OPENAI_MODEL yields a model that fails fast without any network call", async () => {
    for (const env of [{ OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-test" }, { OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "" }]) {
      const model = createInsightModel(loadConfig(envWith(env)));
      expect(model).toBeInstanceOf(NotConfiguredInsightModel);
      await expect(model.complete({ prompt: "p", schema: {}, maxOutputTokens: 1 })).rejects.toBeInstanceOf(InsightModelError);
    }
  });

  it("with both set it returns the OpenAI adapter and the route degrades gracefully when fetch fails", async () => {
    const config = loadConfig(envWith({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-test" }));
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    const insightModel = createInsightModel(config, { fetchImpl });
    expect(insightModel).toBeInstanceOf(OpenAiInsightModel);
    built = await buildTestApp({ config, insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
  });
});
