import { InsightResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createPriceSource } from "../../src/clients/coingecko";
import { OpenAiInsightModel, createInsightModel } from "../../src/clients/openai";
import { loadConfig } from "../../src/config";
import { buildTestApp } from "../helpers/build";

/**
 * B05-23 / B05-24: real OpenAI and CoinGecko calls. Runs only via `pnpm test:live` with
 * OPENAI_API_KEY and OPENAI_MODEL in the repo .env; `pnpm test` never includes this file.
 */
const apiKey = process.env.OPENAI_API_KEY ?? "";
const model = process.env.OPENAI_MODEL ?? "";
const configured = apiKey.length > 0 && model.length > 0;

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe.skipIf(!configured)("live /insight against OpenAI", () => {
  it("B05-23 a real call for ETH returns degraded false and parses with InsightResponse", async () => {
    const config = loadConfig(process.env);
    built = await buildTestApp({ config, insightModel: createInsightModel(config), priceSource: createPriceSource(config) });
    const res = await built.app.inject({
      method: "POST",
      url: "/api/v1/insight",
      payload: { symbol: "ETH", userIntent: "I want to buy on a dip" },
    });
    expect(res.statusCode).toBe(200);
    const body = InsightResponse.parse(res.json());
    // The row asks for the real body to be pasted into docs/WORKLOG.md; the reporter does not show it otherwise.
    process.stdout.write(`B05-23 live insight body: ${JSON.stringify(body)}\n`);
    expect(body.symbol).toBe("ETH");
    expect(body.degraded).toBe(false);
    expect(body.disclaimer).toBe("Not financial advice.");
  });

  it("B05-24 with an invalid key the route still returns 200 with degraded true", async () => {
    const config = loadConfig(process.env);
    const insightModel = new OpenAiInsightModel({ apiKey: "invalid", model: config.openaiModel });
    built = await buildTestApp({ config, insightModel, priceSource: createPriceSource(config) });
    const res = await built.app.inject({ method: "POST", url: "/api/v1/insight", payload: { symbol: "ETH" } });
    expect(res.statusCode).toBe(200);
    const body = InsightResponse.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.suggestedLimit).toBeNull();
  });
});
