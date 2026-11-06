import { ApiError, FlashQuoteResponse, MAX_FLASH_TRADE_USD } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FlashError } from "../src/clients/flash.types";
import { QuotesRepo } from "../src/db/quotes";
import { buildTestApp } from "./helpers/build";
import { FakeClock } from "./helpers/fakes/clock";
import { FakeFlash } from "./helpers/fakes/flashSpy";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const WALLET = "0x1111111111111111111111111111111111111111";

/** The app and its spy share one FakeClock so quote expiry follows built.clock. */
async function build() {
  const clock = new FakeClock();
  const flash = new FakeFlash(clock);
  built = await buildTestApp({ clock, flash });
  return { ...built, flash };
}

function marketBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "2.00", ...overrides };
}

async function postQuote(app: Built["app"], payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
}

describe("B04-01 POST /flash/quote market happy path", () => {
  it("returns 200, parses with FlashQuoteResponse, and asked Flash exactly once", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody());
    expect(res.statusCode).toBe(200);
    const quote = FlashQuoteResponse.parse(res.json());
    expect(quote.orderType).toBe("market");
    expect(quote.spend.amount).toBe("2.00");
    expect(flash.calls.map((c) => c.method)).toEqual(["quote"]);
  });
});

function limitBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return marketBody({ orderType: "limit", limitPriceUsd: "2380.00", ...overrides });
}

describe("B04-02 POST /flash/quote limit happy path", () => {
  it("returns 200 with orderType limit and the limit price forwarded to Flash", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, limitBody());
    expect(res.statusCode).toBe(200);
    expect(FlashQuoteResponse.parse(res.json()).orderType).toBe("limit");
    const call = flash.calls[0];
    expect(call?.method === "quote" && call.input.request.limitPriceUsd).toBe("2380.00");
  });
});

describe("B04-03 limit request without limitPriceUsd", () => {
  it("returns 400 BAD_REQUEST naming limitPriceUsd and never reaches Flash", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ orderType: "limit" }));
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("limitPriceUsd");
    expect(flash.calls).toEqual([]);
  });
});

describe("B04-04 amount is capped at MAX_FLASH_TRADE_USD and must be positive", () => {
  it("5.01 returns 400 BAD_REQUEST naming the cap, without calling Flash", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ amount: "5.01" }));
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("MAX_FLASH_TRADE_USD");
    expect(error.message).toContain(String(MAX_FLASH_TRADE_USD));
    expect(flash.calls).toEqual([]);
  });
  it("exactly 5.00 is accepted", async () => {
    const { app } = await build();
    const res = await postQuote(app, marketBody({ amount: "5.00" }));
    expect(res.statusCode).toBe(200);
    expect(FlashQuoteResponse.parse(res.json()).spend.amount).toBe("5.00");
  });
  it.each(["0", "0.00"])("%s returns 400 BAD_REQUEST (nothing to spend)", async (amount) => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ amount }));
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
    expect(flash.calls).toEqual([]);
  });
  it("more than 6 decimals (below one USDC base unit) returns 400 BAD_REQUEST", async () => {
    const { app } = await build();
    const res = await postQuote(app, marketBody({ amount: "1.0000001" }));
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("B04-05 side is a schema literal", () => {
  it("side: 'sell' returns 400 BAD_REQUEST", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ side: "sell" }));
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
    expect(flash.calls).toEqual([]);
  });
});

describe("B04-06 only Flash-tradable allowlist tokens are quoted", () => {
  it.each([
    ["DOGE", "not in the allowlist"],
    ["BTC", "listed but flashSupported: false"],
    ["pepe", "lower-case lookup of a non-Flash token"],
  ])("%s (%s) returns 400 UNSUPPORTED_TOKEN without calling Flash", async (symbol) => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ symbol }));
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("UNSUPPORTED_TOKEN");
    expect(error.message).toContain(symbol);
    expect(flash.calls).toEqual([]);
  });
  it("a lower-case Flash token is accepted and quoted as its canonical symbol", async () => {
    const { app } = await build();
    const res = await postQuote(app, marketBody({ symbol: "eth" }));
    expect(res.statusCode).toBe(200);
    expect(FlashQuoteResponse.parse(res.json()).receive.symbol).toBe("ETH");
  });
});

describe("B04-08 the quote is stored", () => {
  it("quotes.get(quoteId) returns the response plus wallet, symbol, orderType, expiry and raw typed data", async () => {
    const { app, db, clock } = await build();
    const res = await postQuote(app, limitBody({ symbol: "eth" }));
    expect(res.statusCode).toBe(200);
    const body = FlashQuoteResponse.parse(res.json());
    const stored = new QuotesRepo(db).get(body.quoteId);
    expect(stored).toBeDefined();
    expect(stored?.response).toEqual(body);
    expect(stored).toMatchObject({
      walletAddress: WALLET,
      symbol: "ETH",
      orderType: "limit",
      expiresAt: body.expiresAt,
      createdAt: clock.now(),
      usedAt: null,
    });
    expect(stored?.rawTypedData.orderTypedData).toBe(body.steps.orderTypedData);
    expect(stored?.rawTypedData.permitTypedData).toBe(body.steps.permitTypedData);
  });
});

describe("B04-09 Flash rejects the quote", () => {
  it("FlashError('insufficient liquidity') becomes 502 FLASH_ERROR carrying that message; nothing is stored", async () => {
    const { app, db, flash } = await build();
    flash.failNextQuoteWith = new FlashError("insufficient liquidity");
    const res = await postQuote(app, marketBody());
    expect(res.statusCode).toBe(502);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("FLASH_ERROR");
    expect(error.message).toBe("insufficient liquidity");
    expect(db.prepare("SELECT count(*) AS n FROM quotes").get()).toEqual({ n: 0 });
  });
  it("the mock's own failNextQuote hook takes the same path", async () => {
    const { app, flash } = await build();
    flash.failNextQuote = true;
    const res = await postQuote(app, marketBody());
    expect(res.statusCode).toBe(502);
    expect(ApiError.parse(res.json()).error).toEqual({ code: "FLASH_ERROR", message: "mock failure" });
  });
});

describe("B04-10 typed data passes through unchanged", () => {
  it("steps.orderTypedData and steps.approveTx are exactly what the client returned", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody());
    const body = FlashQuoteResponse.parse(res.json());
    const returned = flash.quotes[0];
    expect(returned).toBeDefined();
    expect(body.steps.orderTypedData).toBe(returned?.steps.orderTypedData);
    expect(body.steps.permitTypedData).toBe(returned?.steps.permitTypedData);
    expect(body.steps.approveTx).toEqual(returned?.steps.approveTx);
    expect(body).toEqual(returned);
  });
  it("a permit typed-data string is passed through byte-for-byte too", async () => {
    const { app, flash } = await build();
    const permit = '{"types":{"PermitSingle":[]},"domain":{"chainId":"8453"},"primaryType":"PermitSingle","message":{"nonce":"0"}}';
    flash.permitTypedData = permit;
    const body = FlashQuoteResponse.parse((await postQuote(app, marketBody())).json());
    expect(body.steps.permitTypedData).toBe(permit);
  });
});

describe("B04-11 unknown body fields are stripped", () => {
  it("an extra field is accepted and not forwarded to Flash", async () => {
    const { app, flash } = await build();
    const res = await postQuote(app, marketBody({ referrer: "evil", slippage: "0.02" }));
    expect(res.statusCode).toBe(200);
    const call = flash.calls[0];
    expect(call?.method).toBe("quote");
    if (call?.method !== "quote") return;
    expect(call.input.request).not.toHaveProperty("referrer");
    expect(call.input.request).toEqual({
      walletAddress: WALLET,
      symbol: "ETH",
      side: "buy",
      orderType: "market",
      amount: "2.00",
      slippage: "0.02",
    });
  });
});

describe("B04-07 walletAddress must be 0x + 40 hex", () => {
  it.each(["0x123", "1111111111111111111111111111111111111111", "0xZZ11111111111111111111111111111111111111"])(
    "%s returns 400 BAD_REQUEST naming walletAddress",
    async (walletAddress) => {
      const { app, flash } = await build();
      const res = await postQuote(app, marketBody({ walletAddress }));
      expect(res.statusCode).toBe(400);
      const error = ApiError.parse(res.json()).error;
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toContain("walletAddress");
      expect(flash.calls).toEqual([]);
    },
  );
});

describe("B04-29 a limit price must be greater than 0", () => {
  it.each(["0", "0.00", "000.000000"])("limitPriceUsd %s returns 400 BAD_REQUEST without calling Flash", async (price) => {
    const { app, db, flash } = await build();
    const res = await postQuote(app, limitBody({ limitPriceUsd: price }));
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error).toEqual({
      code: "BAD_REQUEST",
      message: "limitPriceUsd: must be greater than 0",
    });
    expect(flash.calls).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM quotes").get()).toEqual({ n: 0 });
  });
  it("the smallest positive price 0.000001 is accepted", async () => {
    const { app } = await build();
    expect((await postQuote(app, limitBody({ limitPriceUsd: "0.000001" }))).statusCode).toBe(200);
  });
});

describe("B04-30 a non-Flash error from the adapter's quote() stays a 500", () => {
  it("TypeError becomes 500 INTERNAL with the generic message; nothing is stored", async () => {
    const { app, db, flash } = await build();
    flash.failNextQuoteWith = new TypeError("bug in adapter");
    const res = await postQuote(app, marketBody());
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(db.prepare("SELECT count(*) AS n FROM quotes").get()).toEqual({ n: 0 });
  });
});
