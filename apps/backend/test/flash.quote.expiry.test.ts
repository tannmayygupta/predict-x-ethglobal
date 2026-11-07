import { ApiError, FlashQuoteResponse, MAX_LIMIT_EXPIRY_SECONDS, MIN_LIMIT_EXPIRY_SECONDS } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FlashService } from "../src/services/flash";
import { OrdersRepo } from "../src/db/orders";
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

async function build() {
  const clock = new FakeClock();
  const flash = new FakeFlash(clock);
  built = await buildTestApp({ clock, flash });
  return { ...built, flash };
}

const limitBody = (overrides: Record<string, unknown> = {}) => ({
  walletAddress: WALLET,
  symbol: "ETH",
  side: "buy",
  orderType: "limit",
  amount: "2.00",
  limitPriceUsd: "2380.00",
  ...overrides,
});

async function postQuote(app: Built["app"], payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
}

async function expectBadRequest(res: Awaited<ReturnType<typeof postQuote>>, mentions: string) {
  expect(res.statusCode).toBe(400);
  const error = ApiError.parse(res.json()).error;
  expect(error.code).toBe("BAD_REQUEST");
  expect(error.message).toContain(mentions);
}

describe("expireAt is for limit orders inside a 60 s .. 30 d window", () => {
  it("a market order carrying expireAt is a 400 and never reaches Flash (Flash would answer 400 itself)", async () => {
    const { app, flash, clock } = await build();
    const res = await postQuote(app, { ...limitBody({ orderType: "market" }), expireAt: clock.now() + 3600 });
    await expectBadRequest(res, "expireAt");
    expect(flash.calls).toEqual([]);
  });

  it("a limit order with a valid expiry is quoted, and the deadline of the quote follows it", async () => {
    const { app, clock } = await build();
    const expireAt = clock.now() + 24 * 3600;
    const res = await postQuote(app, limitBody({ expireAt }));
    expect(res.statusCode).toBe(200);
    const quote = FlashQuoteResponse.parse(res.json());
    expect(quote.orderDeadline).toBe(expireAt);
    expect(quote.limitPriceUsd).toBe("2380.00");
  });

  it("a limit order without an expiry is good till cancelled: orderDeadline null", async () => {
    const { app } = await build();
    const quote = FlashQuoteResponse.parse((await postQuote(app, limitBody())).json());
    expect(quote.orderDeadline).toBeNull();
  });

  it.each([
    ["59 s ahead", MIN_LIMIT_EXPIRY_SECONDS - 1],
    ["in the past", -10],
    ["30 days and 1 s ahead", MAX_LIMIT_EXPIRY_SECONDS + 1],
  ])("an expiry %s is a 400 without calling Flash", async (_name, offset) => {
    const { app, flash, clock } = await build();
    await expectBadRequest(await postQuote(app, limitBody({ expireAt: clock.now() + offset })), "expireAt");
    expect(flash.calls).toEqual([]);
  });

  it.each([
    ["exactly 60 s ahead", MIN_LIMIT_EXPIRY_SECONDS],
    ["exactly 30 days ahead", MAX_LIMIT_EXPIRY_SECONDS],
  ])("an expiry %s is accepted", async (_name, offset) => {
    const { app, clock } = await build();
    expect((await postQuote(app, limitBody({ expireAt: clock.now() + offset }))).statusCode).toBe(200);
  });
});

describe("slippage must be greater than 0 and at most 1", () => {
  it.each(["0", "0.0", "1.01", "2"])("%s is a 400 naming slippage", async (slippage) => {
    const { app, flash } = await build();
    await expectBadRequest(await postQuote(app, { ...limitBody({ orderType: "market", limitPriceUsd: undefined }), slippage }), "slippage");
    expect(flash.calls).toEqual([]);
  });
  it.each(["1", "1.0", "0.15", "0.005"])("%s is accepted", async (slippage) => {
    const { app } = await build();
    const res = await postQuote(app, { ...limitBody({ orderType: "market", limitPriceUsd: undefined }), slippage });
    expect(res.statusCode).toBe(200);
    expect(FlashQuoteResponse.parse(res.json()).slippage).toBe(slippage);
  });
});

describe("FlashService checks the same rules itself (the schema is not its only guard)", () => {
  function service() {
    const clock = new FakeClock();
    const db = built?.db;
    if (!db) throw new Error("build the app first");
    return new FlashService({
      flash: new FakeFlash(clock),
      clock,
      quotes: new QuotesRepo(db),
      orders: new OrdersRepo(db),
      ordersEnabled: false,
    });
  }
  const request = {
    walletAddress: WALLET,
    symbol: "ETH",
    side: "buy" as const,
    orderType: "limit" as const,
    amount: "2.00",
    limitPriceUsd: "2380.00",
    slippage: "0.01",
  };

  it("rejects expireAt on a market order, slippage out of range and an expiry out of the window", async () => {
    await build();
    const svc = service();
    await expect(svc.quote({ ...request, orderType: "market", expireAt: 1_761_700_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(svc.quote({ ...request, slippage: "0" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(svc.quote({ ...request, slippage: "1.5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(svc.quote({ ...request, expireAt: 1_761_600_010 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(svc.quote({ ...request, limitPriceUsd: "0.00" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
