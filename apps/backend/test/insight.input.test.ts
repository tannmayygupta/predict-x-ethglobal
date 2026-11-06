import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError, InsightResponse, MAX_INTENT_LENGTH, fixtures } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { InsightsRepo } from "../src/db/insights";
import { migrate, openDb } from "../src/db/sqlite";
import { INSIGHT_INSTRUCTIONS, InsightService, buildInsightInput } from "../src/services/insight";
import { MarketService } from "../src/services/market";
import { buildTestApp } from "./helpers/build";
import { FakeClock } from "./helpers/fakes/clock";
import { FakeInsightModel } from "./helpers/fakes/insightModel";
import { FakePriceSource } from "./helpers/fakes/priceSource";

const market = fixtures.marketEth;

describe("B05-01 buildInsightInput", () => {
  it("contains the symbol, spot price, 24h change, 7d change, the intent and the fixed instruction text", () => {
    const prompt = buildInsightInput({ market, change7dPct: -4.25, userIntent: "I want to buy on a dip" });
    expect(prompt).toContain(INSIGHT_INSTRUCTIONS);
    expect(prompt).toContain("ETH");
    expect(prompt).toContain("2451.12");
    expect(prompt).toContain("-1.8%");
    expect(prompt).toContain("-4.25%");
    expect(prompt).toContain("I want to buy on a dip");
  });

  it("writes 'unknown' for a null 7d change and 'none' for a missing intent", () => {
    const prompt = buildInsightInput({ market, change7dPct: null });
    expect(prompt).toMatch(/7d change: unknown/);
    expect(prompt).toMatch(/User intent[^\n]*: none/);
  });

  it("is the exact fixed template, so nothing but these fields can reach the model", () => {
    const prompt = buildInsightInput({ market, change7dPct: 2.5, userIntent: "hold" });
    expect(prompt).toBe(
      `${INSIGHT_INSTRUCTIONS}\n\nToken: ETH (Ethereum)\nSpot price (USD): 2451.12\n24h change: -1.8%\n7d change: 2.5%\nUser intent (untrusted, from the user): hold`,
    );
  });
});

/* ---------- B05-02 ---------- */

const DRAFT_REPLY = {
  tip: "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  bias: "neutral",
  confidence: "low",
  suggestedLimit: { side: "buy", priceUsd: "2380.00", reason: "About 3% below spot" },
};

function serviceWithoutFlash(model: FakeInsightModel): InsightService {
  const priceSource = new FakePriceSource();
  priceSource.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
  const clock = new FakeClock();
  const db = openDb(":memory:");
  migrate(db);
  // The deps object has no flash member at all: the type forbids it and this literal proves it compiles without one.
  return new InsightService({ market: new MarketService({ priceSource, clock }), model, insights: new InsightsRepo(db), clock });
}

describe("B05-02 the insight path has no Flash dependency and sends no tools (FR-I-04)", () => {
  it("InsightService is built without a flash argument and answers from market data plus the model alone", async () => {
    const model = new FakeInsightModel();
    model.queue(DRAFT_REPLY);
    const service = serviceWithoutFlash(model);
    const response = InsightResponse.parse(await service.get({ symbol: "ETH", userIntent: "buy the dip" }));
    expect(response.symbol).toBe("ETH");
    expect(response.degraded).toBe(false);
    expect(model.calls).toHaveLength(1);
    const call = model.calls[0];
    expect(call).not.toHaveProperty("tools");
    expect(Object.keys(call ?? {}).sort()).toEqual(["maxOutputTokens", "prompt", "schema"]);
    expect(call?.prompt).not.toContain("tweet");
  });

  it("src/services/insight*.ts and src/routes/insight.ts never import the Flash client or service", () => {
    const servicesDir = fileURLToPath(new URL("../src/services/", import.meta.url));
    const files = readdirSync(servicesDir)
      .filter((name) => name.startsWith("insight"))
      .map((name) => join(servicesDir, name));
    files.push(fileURLToPath(new URL("../src/routes/insight.ts", import.meta.url)));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/clients\/flash|services\/flash/);
    }
  });
});

/* ---------- B05-03 ---------- */

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B05-03 userIntent longer than MAX_INTENT_LENGTH is rejected by InsightRequest at the route", () => {
  it("returns 400 BAD_REQUEST naming body.userIntent and never calls the model", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    const priceSource = new FakePriceSource();
    priceSource.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
    built = await buildTestApp({ insightModel, priceSource });
    const tooLong = await built.app.inject({
      method: "POST",
      url: "/api/v1/insight",
      payload: { symbol: "ETH", userIntent: "x".repeat(MAX_INTENT_LENGTH + 1) },
    });
    expect(tooLong.statusCode).toBe(400);
    const parsed = ApiError.parse(tooLong.json());
    expect(parsed.error.code).toBe("BAD_REQUEST");
    expect(parsed.error.message).toContain("body.userIntent");
    expect(insightModel.calls).toEqual([]);

    const atLimit = await built.app.inject({
      method: "POST",
      url: "/api/v1/insight",
      payload: { symbol: "ETH", userIntent: "y".repeat(MAX_INTENT_LENGTH) },
    });
    expect(atLimit.statusCode).toBe(200);
    expect(InsightResponse.parse(atLimit.json()).symbol).toBe("ETH");
    expect(insightModel.calls).toHaveLength(1);
  });
});
