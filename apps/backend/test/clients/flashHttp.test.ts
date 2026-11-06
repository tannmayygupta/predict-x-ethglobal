import {
  FlashOrderDetail,
  FlashOrderResponse,
  FlashQuoteResponse,
  Token,
  fixtures,
  type FlashQuoteRequest,
} from "@predictx/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tokensJson from "../../../../packages/shared/tokens.json";
import { HttpFlashClient } from "../../src/clients/flash.http";
import { toFlashQuoteBody } from "../../src/clients/flash.map";
import { FlashError, FlashNotFoundError, FlashUnknownQuoteError } from "../../src/clients/flash.types";
import type { FlashSubmitInput } from "../../src/clients/flash.types";
import error4xx from "../fixtures/flash/error.4xx.json";
import orderOk from "../fixtures/flash/order.ok.json";
import quoteOk from "../fixtures/flash/quote.ok.json";
import statusFilled from "../fixtures/flash/status.filled.json";
import statusOpen from "../fixtures/flash/status.open.json";
import { FakeClock } from "../helpers/fakes/clock";

const ETH = Token.parse(tokensJson.tokens.find((t) => t.symbol === "ETH"));
const WALLET = "0x1111111111111111111111111111111111111111";
const BASE_URL = "https://flash.test/v1";
const API_KEY = "dpka_test_key_that_must_never_leak";

const marketReq: FlashQuoteRequest = {
  walletAddress: WALLET,
  symbol: "ETH",
  side: "buy",
  orderType: "market",
  amount: "2.00",
  slippage: "0.01",
};

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch stand-in that records every call and answers from a queue (a Response or an Error to throw). */
function clientWith(responses: Array<Response | Error>) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new Error("test: no fetch response queued");
    if (next instanceof Error) throw next;
    return next;
  };
  const clock = new FakeClock();
  const client = new HttpFlashClient({ baseUrl: BASE_URL, apiKey: API_KEY, clock, fetchImpl });
  return { client, calls, clock };
}

function only(calls: RecordedCall[]): RecordedCall {
  const call = calls[0];
  if (call === undefined || calls.length !== 1) throw new Error(`expected exactly one call, got ${calls.length}`);
  return call;
}

describe("B03-15 HttpFlashClient.quote", () => {
  it("POSTs the mapped body to /quote with the api key header and maps the recorded reply", async () => {
    const { client, calls, clock } = clientWith([jsonResponse(quoteOk)]);
    const quote = await client.quote({ request: marketReq, token: ETH });

    const call = only(calls);
    expect(call.url).toBe(`${BASE_URL}/quote`);
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("x-definitive-api-key")).toBe(API_KEY);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toStrictEqual(toFlashQuoteBody(marketReq, ETH));

    const parsed = FlashQuoteResponse.parse(quote);
    expect(parsed.quoteId).toBe(quoteOk.quoteId);
    expect(parsed.steps.orderTypedData).toBe(quoteOk.evm.orderTypedData);
    expect(parsed.steps.permitTypedData).toBeNull();
    expect(parsed.receive.amount).toBe(quoteOk.to.amount);
    expect(parsed.expiresAt).toBe(clock.now() + 60);
  });

  it("throws FlashError when a 200 reply is not a quote body", async () => {
    const { client } = clientWith([jsonResponse({ hello: "world" })]);
    await expect(client.quote({ request: marketReq, token: ETH })).rejects.toBeInstanceOf(FlashError);
  });
});

const ORDER_SIG = "0xaaaa";

function orderFor(quote: FlashQuoteResponse): FlashSubmitInput {
  return {
    quote,
    rawTypedData: { orderTypedData: quote.steps.orderTypedData, permitTypedData: quote.steps.permitTypedData },
    order: { quoteId: quote.quoteId, walletAddress: WALLET, orderSignature: ORDER_SIG, permitSignature: null },
  };
}

describe("B03-16 HttpFlashClient.submit", () => {
  it("POSTs the trade fields, the untouched typed data and the signature to /order and maps the 201 reply", async () => {
    const { client, calls } = clientWith([jsonResponse(quoteOk), jsonResponse(orderOk, 201)]);
    const quote = await client.quote({ request: marketReq, token: ETH });
    const result = await client.submit(orderFor(quote));

    expect(FlashOrderResponse.parse(result)).toStrictEqual({ orderId: orderOk.orderId, status: "submitted" });
    expect(calls).toHaveLength(2);
    const call = calls[1];
    expect(call?.url).toBe(`${BASE_URL}/order`);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("x-definitive-api-key")).toBe(API_KEY);
    const sent: unknown = JSON.parse(String(call?.init.body));
    expect(sent).toStrictEqual({
      ...toFlashQuoteBody(marketReq, ETH),
      quoteId: quoteOk.quoteId,
      userSignature: ORDER_SIG,
      evmOrderTypedData: quoteOk.evm.orderTypedData,
    });
  });

  it("throws FlashUnknownQuoteError (no HTTP call) for a quote this process never issued, e.g. after a restart", async () => {
    const { client, calls } = clientWith([]);
    const quote: FlashQuoteResponse = { ...fixtures.quoteEthMarket, quoteId: "unknown-quote" };
    const call = client.submit(orderFor(quote));
    await expect(call).rejects.toBeInstanceOf(FlashUnknownQuoteError);
    await expect(call).rejects.toThrow(/unknown-quote/);
    expect(calls).toHaveLength(0);
  });

  it("hasQuote is false for a quote this process never issued and true once it issued it", async () => {
    const { client } = clientWith([jsonResponse(quoteOk)]);
    expect(client.hasQuote(quoteOk.quoteId)).toBe(false);
    const quote = await client.quote({ request: marketReq, token: ETH });
    expect(client.hasQuote(quote.quoteId)).toBe(true);
    expect(client.hasQuote("unknown-quote")).toBe(false);
  });
});

describe("B03-17 HttpFlashClient.status", () => {
  it("GETs /orders/{id}?funderAddress= and maps the recorded filled reply to filled with the fill's txHash", async () => {
    const { client, calls } = clientWith([jsonResponse(statusFilled)]);
    const orderId = statusFilled.order.orderId;
    const detail = FlashOrderDetail.parse(await client.status({ orderId, orderType: "market", funderAddress: WALLET }));

    const call = only(calls);
    expect(call.url).toBe(`${BASE_URL}/orders/${orderId}?funderAddress=${WALLET}`);
    expect(call.init.method).toBe("GET");
    expect(call.init.body).toBeUndefined();
    expect(new Headers(call.init.headers).get("x-definitive-api-key")).toBe(API_KEY);

    expect(detail).toStrictEqual({
      orderId,
      status: "filled",
      orderType: "market",
      txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
      chainId: 8453,
      filledAmount: "0.000839",
      error: null,
      updatedAt: 1_761_602_430,
    });
  });

  it("maps the recorded resting limit order to open with txHash null and updatedAt from acceptedAt", async () => {
    const { client } = clientWith([jsonResponse(statusOpen)]);
    const orderId = statusOpen.order.orderId;
    const detail = FlashOrderDetail.parse(await client.status({ orderId, orderType: "limit", funderAddress: WALLET }));
    expect(detail.status).toBe("open");
    expect(detail.txHash).toBeNull();
    expect(detail.filledAmount).toBeNull();
    expect(detail.error).toBeNull();
    expect(detail.orderType).toBe("limit");
    expect(detail.updatedAt).toBe(1_761_602_405);
  });
});

describe("B03-18 upstream 4xx carries the upstream reason", () => {
  it("documented { error: { code, message } } body -> FlashError 'CODE: message'", async () => {
    const { client } = clientWith([jsonResponse(error4xx, 400)]);
    const call = client.quote({ request: marketReq, token: ETH });
    await expect(call).rejects.toBeInstanceOf(FlashError);
    await expect(call).rejects.toThrow("VALIDATION_ERROR: Request validation failed");
  });

  it("observed bare-string 401 body -> FlashError with that string", async () => {
    const { client } = clientWith([jsonResponse({ error: "API key required" }, 401)]);
    await expect(client.quote({ request: marketReq, token: ETH })).rejects.toThrow("API key required");
  });

  it("text/plain body -> FlashError with the status and the text", async () => {
    const { client } = clientWith([new Response("404 Not Found", { status: 405, headers: { "content-type": "text/plain" } })]);
    await expect(client.quote({ request: marketReq, token: ETH })).rejects.toThrow("flash http 405: 404 Not Found");
  });

  it("404 on status -> FlashNotFoundError (a FlashError) so routes answer NOT_FOUND", async () => {
    const body = { error: { code: "NOT_FOUND", message: "flash get order failed: order x not found" } };
    const { client } = clientWith([jsonResponse(body, 404)]);
    const call = client.status({ orderId: "x", orderType: "market", funderAddress: WALLET });
    await expect(call).rejects.toBeInstanceOf(FlashNotFoundError);
    await expect(call).rejects.toThrow("NOT_FOUND: flash get order failed: order x not found");
  });
});

describe("B03-19 upstream 5xx or network failure", () => {
  it.each([
    ["500 with a JSON error body", jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500)],
    ["503 text/plain", new Response("Service Unavailable", { status: 503 })],
    ["504 gateway timeout", new Response("", { status: 504 })],
  ])("%s -> FlashError('flash unavailable')", async (_name, response) => {
    const { client } = clientWith([response]);
    const call = client.quote({ request: marketReq, token: ETH });
    await expect(call).rejects.toBeInstanceOf(FlashError);
    await expect(call).rejects.toThrow("flash unavailable");
  });

  it("fetch rejecting (DNS, TLS, reset) -> FlashError('flash unavailable') with the cause attached", async () => {
    const network = new TypeError("fetch failed");
    const { client } = clientWith([network]);
    const call = client.status({ orderId: "x", orderType: "market", funderAddress: WALLET });
    await expect(call).rejects.toBeInstanceOf(FlashError);
    await expect(call).rejects.toThrow("flash unavailable");
    await expect(call).rejects.toMatchObject({ cause: network });
  });
});

describe("B03-20 the API key never leaves the header", () => {
  it("is absent from every request body and present only in the x-definitive-api-key header", async () => {
    const { client, calls } = clientWith([jsonResponse(quoteOk), jsonResponse(orderOk, 201), jsonResponse(statusFilled)]);
    const quote = await client.quote({ request: marketReq, token: ETH });
    await client.submit(orderFor(quote));
    await client.status({ orderId: statusFilled.order.orderId, orderType: "market", funderAddress: WALLET });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.url).not.toContain(API_KEY);
      expect(String(call.init.body ?? "")).not.toContain(API_KEY);
      const headers = new Headers(call.init.headers);
      expect(headers.get("x-definitive-api-key")).toBe(API_KEY);
      expect(headers.get("authorization")).toBeNull();
    }
  });

  it("is scrubbed from an upstream error message that echoes it", async () => {
    const echoing = { error: { code: "UNAUTHORIZED", message: `key ${API_KEY} is not valid` } };
    const { client } = clientWith([jsonResponse(echoing, 403)]);
    const call = client.quote({ request: marketReq, token: ETH });
    await expect(call).rejects.toBeInstanceOf(FlashError);
    await expect(call).rejects.not.toThrow(API_KEY);
    await expect(call).rejects.toThrow("UNAUTHORIZED: key [redacted] is not valid");
  });

  it("is absent from the message when fetch itself fails mentioning the request", async () => {
    const { client } = clientWith([new Error(`connect failed for request with ${API_KEY}`)]);
    const call = client.quote({ request: marketReq, token: ETH });
    await expect(call).rejects.toThrow("flash unavailable");
    await expect(call).rejects.not.toThrow(API_KEY);
  });
});

describe("B03-21 requests time out at 5 s", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the fetch signal at 5000 ms (not before) and rejects with a FlashError naming the timeout", async () => {
    let signal: AbortSignal | undefined;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(signal?.reason));
      });
    const client = new HttpFlashClient({ baseUrl: BASE_URL, apiKey: API_KEY, clock: new FakeClock(), fetchImpl: hanging });
    const outcome = client.quote({ request: marketReq, token: ETH }).then(
      () => "resolved",
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);

    const err = await outcome;
    expect(err).toBeInstanceOf(FlashError);
    expect(err).toMatchObject({ message: "flash timed out after 5000 ms" });
    expect(String(err)).not.toContain(API_KEY);
  });

  it("clears the timer after a prompt reply so nothing fires later", async () => {
    const { client } = clientWith([jsonResponse(quoteOk)]);
    await client.quote({ request: marketReq, token: ETH });
    expect(vi.getTimerCount()).toBe(0);
  });
});
