import { ApiError, InsightResponse, fixtures } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSourceError } from "../../src/clients/priceSource";
import { buildTestApp } from "../helpers/build";
import { FakeInsightModel } from "../helpers/fakes/insightModel";
import { FakePriceSource } from "../helpers/fakes/priceSource";

/**
 * T-B05's row of the FR-B-01 contract table (B04-29, B05-22) plus the error codes only /insight can
 * raise (B04-30). Shapes come only from @predictx/shared (X-05).
 */

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

/** API_CONTRACT.md section 3, the documented request. */
const CANONICAL_REQUEST = { symbol: "ETH", userIntent: "I want to buy on a dip" };
const INSIGHT_LIMIT_PER_MINUTE = 10;

function pricedSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
  return source;
}

/** The shared fixture minus the fields the service sets is exactly what the model is asked for. */
function fixtureReply(): FakeInsightModel {
  const { symbol: _symbol, degraded: _degraded, disclaimer: _disclaimer, ...draft } = fixtures.insightEth;
  const model = new FakeInsightModel();
  model.queue(draft);
  return model;
}

async function postInsight(app: Built["app"], payload: Record<string, unknown> = CANONICAL_REQUEST) {
  return app.inject({ method: "POST", url: "/api/v1/insight", payload, remoteAddress: "127.0.0.1" });
}

describe("B04-29 contract row owned by T-B05 (FR-B-01)", () => {
  it("POST /insight with the canonical request returns 200 and parses with InsightResponse", async () => {
    built = await buildTestApp({ insightModel: fixtureReply(), priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(() => InsightResponse.parse(res.json())).not.toThrow();
    // Part A's mock server serves fixtures.insightEth; the live service reproduces it field for field.
    expect(InsightResponse.parse(res.json())).toEqual(fixtures.insightEth);
  });

  it("POST /insight without the LLM still returns 200 and parses, with degraded true (FR-I-03)", async () => {
    built = await buildTestApp({ priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
  });
});

describe("B04-30 error codes reachable through /insight parse with ApiError (FR-B-07)", () => {
  it("BAD_REQUEST 400 for an empty body", async () => {
    built = await buildTestApp({ priceSource: pricedSource() });
    const res = await postInsight(built.app, {});
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("UNSUPPORTED_TOKEN 400 for a symbol outside tokens.json", async () => {
    built = await buildTestApp({ priceSource: pricedSource() });
    const res = await postInsight(built.app, { symbol: "DOGE" });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("UNSUPPORTED_TOKEN");
  });

  it("LLM_UNAVAILABLE 503 when no spot price exists to build even the fallback", async () => {
    const priceSource = new FakePriceSource();
    priceSource.failWith = new PriceSourceError("coingecko 500", 500);
    built = await buildTestApp({ insightModel: fixtureReply(), priceSource });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error.code).toBe("LLM_UNAVAILABLE");
  });

  it("RATE_LIMITED 429 on the 11th request within a minute", async () => {
    built = await buildTestApp({ insightModel: fixtureReply(), priceSource: pricedSource() });
    for (let i = 0; i < INSIGHT_LIMIT_PER_MINUTE; i += 1) await postInsight(built.app);
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(429);
    expect(ApiError.parse(res.json()).error.code).toBe("RATE_LIMITED");
  });
});
