import { ApiError, InsightResponse, fixtures } from "@predictx/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSIGHT_SCHEMA_NAME, InsightModelError } from "../src/clients/insightModel";
import { OPENAI_TIMEOUT_MS, OpenAiInsightModel } from "../src/clients/openai";
import { PriceSourceError } from "../src/clients/priceSource";
import { INSIGHT_MAX_OUTPUT_TOKENS, fallbackInsight } from "../src/services/insight";
import { insightJsonSchema } from "../src/services/insight.schema";
import { SPOT_TTL_SECONDS } from "../src/services/market";
import { buildTestApp } from "./helpers/build";
import { FakeInsightModel } from "./helpers/fakes/insightModel";
import { FakePriceSource } from "./helpers/fakes/priceSource";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
  vi.useRealTimers();
});

const DRAFT_REPLY = {
  tip: "ETH is down 1.8% today. A limit buy a few percent below spot avoids chasing the move.",
  bias: "neutral",
  confidence: "low",
  suggestedLimit: { side: "buy", priceUsd: "2380.00", reason: "About 3% below spot" },
};
const SERVICE_OWNED_FIELDS = ["symbol", "degraded", "disclaimer"];

function pricedSource(usd = 2451.12, usd24hChange = -1.8): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = { usd, usd24hChange };
  return source;
}

async function postInsight(app: Built["app"], payload: Record<string, unknown> = { symbol: "ETH" }) {
  return app.inject({ method: "POST", url: "/api/v1/insight", payload });
}

/* ---------- OpenAI adapter test double: records what the SDK sends, answers with a canned Responses body ---------- */

type RecordedRequest = { url: string; headers: Headers; body: Record<string, unknown> };

function openaiFetch(handler: (attempt: number) => { status: number; body: unknown }) {
  const calls: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), headers: new Headers(init?.headers), body });
    const reply = handler(calls.length);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

/** A Responses API body in the shape the SDK parses (docs/notes/openai-structured-outputs.md section 10). */
function responsesBody(content: unknown[], extra: Record<string, unknown> = {}) {
  const output = [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content }];
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
  return { id: "resp_1", object: "response", created_at: 0, status: "completed", model: "gpt-test", incomplete_details: null, error: null, output, usage, ...extra };
}

const outputText = (value: unknown) => [{ type: "output_text", text: JSON.stringify(value), annotations: [] }];

const BASE_URL = "https://openai.test/v1";
const MODEL_INPUT = { prompt: "prompt text", schema: insightJsonSchema, maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS };

function adapter(fetchImpl: typeof fetch, apiKey = "sk-test-key"): OpenAiInsightModel {
  return new OpenAiInsightModel({ apiKey, model: "gpt-test", baseURL: BASE_URL, fetchImpl });
}

describe("B05-04 one model call with max_output_tokens 300 and the schema derived from InsightResponse", () => {
  it("the service calls the model once with maxOutputTokens 300 and a strict schema minus symbol, degraded, disclaimer", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(insightModel.calls).toHaveLength(1);
    const call = insightModel.calls[0];
    expect(call?.maxOutputTokens).toBe(300);
    const schema = call?.schema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    const expectedKeys = Object.keys(InsightResponse.shape).filter((k) => !SERVICE_OWNED_FIELDS.includes(k));
    expect(Object.keys(schema.properties)).toEqual(expectedKeys);
    expect(schema.required).toEqual(expectedKeys);
    expect(schema.additionalProperties).toBe(false);
    for (const owned of SERVICE_OWNED_FIELDS) expect(JSON.stringify(schema)).not.toContain(`"${owned}"`);
  });

  it("OpenAiInsightModel sends one Responses request with text.format json_schema strict, max_output_tokens and no tools", async () => {
    const { calls, fetchImpl } = openaiFetch(() => ({ status: 200, body: responsesBody(outputText(DRAFT_REPLY)) }));
    const reply = await adapter(fetchImpl).complete(MODEL_INPUT);
    expect(reply).toEqual(DRAFT_REPLY);
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request?.url).toBe(`${BASE_URL}/responses`);
    expect(request?.headers.get("authorization")).toBe("Bearer sk-test-key");
    expect(request?.body).toMatchObject({
      model: "gpt-test",
      input: "prompt text",
      max_output_tokens: 300,
      store: false,
      text: { format: { type: "json_schema", name: INSIGHT_SCHEMA_NAME, strict: true, schema: insightJsonSchema } },
    });
    expect(request?.body).not.toHaveProperty("tools");
    expect(request?.body).not.toHaveProperty("tool_choice");
  });
});

describe("B05-05 a valid model reply", () => {
  it("yields 200, parses with InsightResponse, degraded false, the symbol echoed and the fixed disclaimer", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app, { symbol: "eth", userIntent: "I want to buy on a dip" });
    expect(res.statusCode).toBe(200);
    const body = InsightResponse.parse(res.json());
    expect(body).toEqual({ symbol: "ETH", ...DRAFT_REPLY, degraded: false, disclaimer: "Not financial advice." });
  });
});

describe("B05-06 a reply that fails the schema", () => {
  it("is retried exactly once; a second bad reply yields the static fallback with degraded true and HTTP 200", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue({ tip: "no bias here" });
    insightModel.queue({ ...DRAFT_REPLY, confidence: "certain" });
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    const body = InsightResponse.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.symbol).toBe("ETH");
    expect(insightModel.calls).toHaveLength(2);
  });

  it("a good reply on the retry is served as a normal, non-degraded insight", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queue("not even an object");
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json())).toMatchObject({ ...DRAFT_REPLY, degraded: false });
    expect(insightModel.calls).toHaveLength(2);
  });
});

const AUTH_ERROR = { error: { message: "Incorrect API key provided: sk-bad***", type: "invalid_request_error", code: "invalid_api_key" } };
const RATE_LIMIT_ERROR = { error: { message: "Rate limit reached", type: "rate_limit_error" } };

describe("B05-07 the model throws (network, 401 bad key, 429)", () => {
  it("retries once, then serves the fallback with degraded true and HTTP 200", async () => {
    const insightModel = new FakeInsightModel();
    insightModel.queueError(new InsightModelError("network down"));
    insightModel.queueError(new TypeError("fetch failed"));
    built = await buildTestApp({ insightModel, priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
    expect(insightModel.calls).toHaveLength(2);
  });

  it("an invalid key through the real adapter: 401 twice (the SDK itself never retries), 200 degraded, key absent from logs", async () => {
    const { calls, fetchImpl } = openaiFetch(() => ({ status: 401, body: AUTH_ERROR }));
    const logs = new LogCapture();
    const secret = "sk-this-key-is-invalid";
    built = await buildTestApp({ insightModel: adapter(fetchImpl, secret), priceSource: pricedSource(), logStream: logs });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
    expect(calls).toHaveLength(2);
    expect(logs.text()).not.toContain(secret);
    expect(logs.text()).toContain("401");
  });

  it("429 through the real adapter is one fetch per attempt and ends degraded", async () => {
    const { calls, fetchImpl } = openaiFetch(() => ({ status: 429, body: RATE_LIMIT_ERROR }));
    built = await buildTestApp({ insightModel: adapter(fetchImpl), priceSource: pricedSource() });
    const res = await postInsight(built.app);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["a refusal", responsesBody([{ type: "refusal", refusal: "I cannot help with that." }]), /refused/],
    [
      "an incomplete (max_output_tokens) response",
      responsesBody(outputText({ tip: "cut" }), { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
      /incomplete.*max_output_tokens/,
    ],
    ["a response with no message output", responsesBody([]), /no JSON output/],
  ])("%s rejects with InsightModelError instead of a half-built insight", async (_name, body, message) => {
    const { fetchImpl } = openaiFetch(() => ({ status: 200, body }));
    const failure = adapter(fetchImpl).complete(MODEL_INPUT);
    await expect(failure).rejects.toBeInstanceOf(InsightModelError);
    await expect(failure).rejects.toThrow(message);
  });

  it("a fetch that throws (DNS, connection reset) rejects with InsightModelError", async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    await expect(adapter(failing).complete(MODEL_INPUT)).rejects.toBeInstanceOf(InsightModelError);
  });
});

/** Never answers; rejects only when the SDK's own timeout aborts the signal, like Node's fetch does. */
function hangingFetch() {
  let aborted = 0;
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted += 1;
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
  return { fetchImpl, abortedCount: () => aborted };
}

describe("B05-08 a model call that hangs", () => {
  it("is aborted by the adapter after OPENAI_TIMEOUT_MS (8 s) and surfaces as InsightModelError, not earlier", async () => {
    vi.useFakeTimers();
    const { fetchImpl, abortedCount } = hangingFetch();
    let settled: string | undefined;
    const pending = adapter(fetchImpl)
      .complete(MODEL_INPUT)
      .then(() => (settled = "resolved"))
      .catch((err: unknown) => (settled = err instanceof InsightModelError ? err.message : "wrong error"));
    await vi.advanceTimersByTimeAsync(OPENAI_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(abortedCount()).toBe(1);
    expect(settled).toBe(`openai request timed out after ${OPENAI_TIMEOUT_MS} ms`);
    expect(OPENAI_TIMEOUT_MS).toBe(8_000);
  });

  it("counts as a failed attempt end to end: two hung attempts and the route still answers 200 degraded", async () => {
    vi.useFakeTimers();
    const { fetchImpl, abortedCount } = hangingFetch();
    built = await buildTestApp({ insightModel: adapter(fetchImpl), priceSource: pricedSource() });
    const pending = postInsight(built.app);
    await vi.advanceTimersByTimeAsync(OPENAI_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(OPENAI_TIMEOUT_MS);
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json()).degraded).toBe(true);
    expect(abortedCount()).toBe(2);
  });
});

describe("B05-09 fallback text", () => {
  it.each([
    [-1.8, "down", "1.8%"],
    [0.38204610173698295, "up", "0.4%"],
    [0, "flat", "0.0%"],
  ])("for a 24h change of %s says %s %s, with neutral bias, low confidence and no suggested limit", async (change, direction, pct) => {
    const insightModel = new FakeInsightModel();
    built = await buildTestApp({ insightModel, priceSource: pricedSource(2451.12, change) });
    const first = InsightResponse.parse((await postInsight(built.app)).json());
    const second = InsightResponse.parse((await postInsight(built.app)).json());
    expect(second).toEqual(first);
    expect(first).toMatchObject({ symbol: "ETH", bias: "neutral", confidence: "low", suggestedLimit: null, degraded: true });
    expect(first.tip).toContain("ETH");
    expect(first.tip).toContain(`${direction} ${pct}`);
    expect(first.tip).toContain("2451.12");
    expect(first.tip).toBe(fallbackInsight({ ...fixtures.marketEth, change24hPct: change }).tip);
  });
});

describe("B05-09b fallback spot is readable: 2 decimals from $1, else up to 8 significant digits", () => {
  it.each([["2322.7531070955583", "$2322.75"], ["2451.12", "$2451.12"], ["81269", "$81269.00"], ["0.000012345678912", "$0.000012345679"], ["0.5", "$0.5"], ["0", "$0"]])(
    "%s reads %s",
    (priceUsd, shown) => expect(fallbackInsight({ ...fixtures.marketEth, priceUsd }).tip).toContain(`at ${shown}. `),
  );
});

describe("B05-10 LLM_UNAVAILABLE only when the fallback cannot be built", () => {
  it("returns 503 LLM_UNAVAILABLE when the price source fails with nothing cached, without calling the model", async () => {
    const priceSource = new FakePriceSource();
    priceSource.failWith = new PriceSourceError("coingecko 500", 500);
    const insightModel = new FakeInsightModel();
    insightModel.queue(DRAFT_REPLY);
    built = await buildTestApp({ insightModel, priceSource });
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error.code).toBe("LLM_UNAVAILABLE");
    expect(insightModel.calls).toEqual([]);
  });

  it("a stale cached price is enough: the price source may fail and the route still answers 200", async () => {
    const priceSource = pricedSource();
    const insightModel = new FakeInsightModel();
    built = await buildTestApp({ insightModel, priceSource });
    await built.app.inject({ method: "GET", url: "/api/v1/market/ETH" });
    built.clock.advance(SPOT_TTL_SECONDS + 1);
    priceSource.failWith = new PriceSourceError("coingecko 500", 500);
    const res = await postInsight(built.app);
    expect(res.statusCode).toBe(200);
    expect(InsightResponse.parse(res.json())).toMatchObject({ symbol: "ETH", degraded: true });
  });
});
