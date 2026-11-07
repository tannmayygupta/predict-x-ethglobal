import { InsightResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { InsightModelError } from "../src/clients/insightModel";
import { buildTestApp } from "./helpers/build";
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

function pricedSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
  return source;
}

async function postInsight(app: Built["app"]) {
  return app.inject({ method: "POST", url: "/api/v1/insight", payload: { symbol: "ETH" } });
}

describe("one retry, and only for a transient failure", () => {
  it("a refusal or a non-retryable model error is not retried; a plain transient error is, exactly once", async () => {
    const refusal = new FakeInsightModel();
    refusal.queueError(new InsightModelError("openai refused: no", { retryable: false }));
    built = await buildTestApp({ insightModel: refusal, priceSource: pricedSource() });
    expect(InsightResponse.parse((await postInsight(built.app)).json()).degraded).toBe(true);
    expect(refusal.calls).toHaveLength(1);
    await built.app.close();

    const transient = new FakeInsightModel();
    transient.queueError(new InsightModelError("openai 503 error"));
    transient.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel: transient, priceSource: pricedSource() });
    expect(InsightResponse.parse((await postInsight(built.app)).json()).degraded).toBe(false);
    expect(transient.calls).toHaveLength(2);
  });

});
