import { ApiError, FlashOrderResponse, FlashQuoteResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FlashError, FlashUnknownQuoteError } from "../src/clients/flash.types";
import { OrdersRepo } from "../src/db/orders";
import { QuotesRepo } from "../src/db/quotes";
import { buildTestApp } from "./helpers/build";
import { FakeClock } from "./helpers/fakes/clock";
import { FakeFlash } from "./helpers/fakes/flashSpy";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const ORDER_SIGNATURE = `0x${"ab".repeat(65)}`;
const PERMIT_SIGNATURE = `0x${"cd".repeat(65)}`;
const PERMIT_TYPED_DATA =
  '{"types":{"PermitSingle":[]},"domain":{"chainId":"8453"},"primaryType":"PermitSingle","message":{"nonce":"0"}}';

/** The app and its spy share one FakeClock so quote expiry follows built.clock. */
async function build(logs?: LogCapture, makeFlash = (clock: FakeClock) => new FakeFlash(clock)) {
  const clock = new FakeClock();
  const flash = makeFlash(clock);
  built = await buildTestApp({ clock, flash, ...(logs ? { logStream: logs } : {}) });
  return { ...built, flash };
}

async function quote(app: Built["app"], orderType: "market" | "limit" = "market"): Promise<FlashQuoteResponse> {
  const payload = { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType, amount: "2.00", limitPriceUsd: "2380.00" };
  const res = await app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
  expect(res.statusCode).toBe(200);
  return FlashQuoteResponse.parse(res.json());
}

async function postOrder(app: Built["app"], payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/flash/order", payload });
}

function orderBody(quoteId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null, ...overrides };
}

describe("B04-12 POST /flash/order happy path", () => {
  it("quote then order returns 200 { orderId, status: 'submitted' } and submits the stored quote and signature", async () => {
    const logs = new LogCapture();
    const { app, flash } = await build(logs);
    const q = await quote(app);
    const res = await postOrder(app, orderBody(q.quoteId));
    expect(res.statusCode).toBe(200);
    const body = FlashOrderResponse.parse(res.json());
    expect(body.status).toBe("submitted");
    expect(body.orderId.length).toBeGreaterThan(0);
    const submit = flash.calls.find((c) => c.method === "submit");
    expect(submit?.method).toBe("submit");
    if (submit?.method !== "submit") return;
    expect(submit.input.quote).toEqual(q);
    expect(submit.input.rawTypedData.orderTypedData).toBe(q.steps.orderTypedData);
    expect(submit.input.order.orderSignature).toBe(ORDER_SIGNATURE);
    expect(submit.input.order.walletAddress).toBe(WALLET);
    // RULES 2.7: neither the signature nor the typed data may reach a log line.
    expect(logs.text()).not.toContain(ORDER_SIGNATURE);
    expect(logs.text()).not.toContain(q.steps.orderTypedData);
  });
});

describe("B04-13 the order is stored and linked to the quote", () => {
  it("orders.get(orderId) carries quoteId, wallet, orderType and a submitted detail stamped with clock.now()", async () => {
    const { app, db, clock } = await build();
    const q = await quote(app, "limit");
    const { orderId } = FlashOrderResponse.parse((await postOrder(app, orderBody(q.quoteId))).json());
    const stored = new OrdersRepo(db).get(orderId);
    expect(stored).toBeDefined();
    expect(stored?.quoteId).toBe(q.quoteId);
    expect(stored).toMatchObject({
      orderId,
      walletAddress: WALLET,
      orderType: "limit",
      status: "submitted",
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
    expect(stored?.detail).toEqual({
      orderId,
      status: "submitted",
      orderType: "limit",
      txHash: null,
      chainId: q.chainId,
      filledAmount: null,
      error: null,
      updatedAt: clock.now(),
    });
  });
});

async function expectQuoteExpired(res: Awaited<ReturnType<typeof postOrder>>) {
  expect(res.statusCode).toBe(409);
  expect(ApiError.parse(res.json()).error.code).toBe("QUOTE_EXPIRED");
}

describe("B04-14 unknown quoteId", () => {
  it("returns 409 QUOTE_EXPIRED and never calls submit", async () => {
    const { app, flash } = await build();
    await expectQuoteExpired(await postOrder(app, orderBody("q_nope")));
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
  });
});

describe("B04-15 quote past expiresAt", () => {
  it("61 s after the quote returns 409 QUOTE_EXPIRED and Flash submit is not called", async () => {
    const { app, clock, flash } = await build();
    const q = await quote(app);
    clock.advance(61);
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
  });
});

describe("B04-16 expiry boundary is now >= expiresAt", () => {
  it("one second before expiresAt is accepted; at exactly expiresAt it is expired", async () => {
    const { app, clock } = await build();
    const early = await quote(app);
    clock.set(early.expiresAt - 1);
    expect((await postOrder(app, orderBody(early.quoteId))).statusCode).toBe(200);
    const late = await quote(app);
    clock.set(late.expiresAt);
    await expectQuoteExpired(await postOrder(app, orderBody(late.quoteId)));
  });
});

describe("B04-17 walletAddress must match the quote's funder", () => {
  it("another wallet returns 400 BAD_REQUEST naming walletAddress; submit is not called and the quote stays usable", async () => {
    const { app, flash } = await build();
    const q = await quote(app);
    const res = await postOrder(app, orderBody(q.quoteId, { walletAddress: OTHER_WALLET }));
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("walletAddress");
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
    expect((await postOrder(app, orderBody(q.quoteId))).statusCode).toBe(200);
  });
  it("the same wallet in a different hex case is the same funder", async () => {
    const { app } = await build();
    const q = await quote(app);
    const res = await postOrder(app, orderBody(q.quoteId, { walletAddress: WALLET.toUpperCase().replace("0X", "0x") }));
    expect(res.statusCode).toBe(200);
  });
});

describe("B04-18 a quote is single-use (D-B1)", () => {
  it("the second order for the same quote returns 409 QUOTE_EXPIRED and Flash is submitted once", async () => {
    const { app, flash } = await build();
    const q = await quote(app);
    expect((await postOrder(app, orderBody(q.quoteId))).statusCode).toBe(200);
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(flash.calls.filter((c) => c.method === "submit")).toHaveLength(1);
  });
});

function submittedOrder(flash: FakeFlash) {
  const call = flash.calls.find((c) => c.method === "submit");
  return call?.method === "submit" ? call.input.order : undefined;
}

describe("B04-19 permitSignature is forwarded only when the quote carried permit typed data", () => {
  it("without a stored permit, a permitSignature in the request is dropped before submit", async () => {
    const { app, flash } = await build();
    const q = await quote(app);
    expect(q.steps.permitTypedData).toBeNull();
    const res = await postOrder(app, orderBody(q.quoteId, { permitSignature: PERMIT_SIGNATURE }));
    expect(res.statusCode).toBe(200);
    expect(submittedOrder(flash)?.permitSignature ?? null).toBeNull();
  });
  it("with a stored permit, the permitSignature and the stored permit typed data reach submit unchanged", async () => {
    const { app, flash } = await build();
    flash.permitTypedData = PERMIT_TYPED_DATA;
    const q = await quote(app);
    expect(q.steps.permitTypedData).toBe(PERMIT_TYPED_DATA);
    const res = await postOrder(app, orderBody(q.quoteId, { permitSignature: PERMIT_SIGNATURE }));
    expect(res.statusCode).toBe(200);
    expect(submittedOrder(flash)?.permitSignature).toBe(PERMIT_SIGNATURE);
    const submit = flash.calls.find((c) => c.method === "submit");
    expect(submit?.method === "submit" && submit.input.rawTypedData.permitTypedData).toBe(PERMIT_TYPED_DATA);
  });
  it("with a stored permit but no permitSignature, 400 BAD_REQUEST before submit and the quote stays usable", async () => {
    const { app, flash } = await build();
    flash.permitTypedData = PERMIT_TYPED_DATA;
    const q = await quote(app);
    const res = await postOrder(app, orderBody(q.quoteId, { permitSignature: null }));
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("permitSignature");
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
    expect((await postOrder(app, orderBody(q.quoteId, { permitSignature: PERMIT_SIGNATURE }))).statusCode).toBe(200);
  });
});

describe("B04-20 Flash rejects the submit", () => {
  it("returns 502 FLASH_ERROR with Flash's reason and writes no order row (pinned: no row)", async () => {
    const { app, db, flash } = await build();
    const q = await quote(app);
    flash.failNextSubmit = new FlashError("PERMISSION_DENIED: signature verification failed");
    const res = await postOrder(app, orderBody(q.quoteId));
    expect(res.statusCode).toBe(502);
    expect(ApiError.parse(res.json()).error).toEqual({
      code: "FLASH_ERROR",
      message: "PERMISSION_DENIED: signature verification failed",
    });
    expect(db.prepare("SELECT count(*) AS n FROM orders").get()).toEqual({ n: 0 });
    // Flash may have created the order despite the error (notes 4.3), so the quote is spent, never resubmitted.
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(flash.calls.filter((c) => c.method === "submit")).toHaveLength(1);
  });
});

describe("B04-21 orderSignature is required hex", () => {
  it.each([
    ["missing", { orderSignature: undefined }],
    ["not hex", { orderSignature: "abc" }],
    ["hex with a bad character", { orderSignature: "0x12zz" }],
    ["permitSignature not hex", { permitSignature: "nope" }],
  ])("%s returns 400 BAD_REQUEST without touching the quote", async (_name, overrides) => {
    const { app, flash } = await build();
    const q = await quote(app);
    const res = await postOrder(app, orderBody(q.quoteId, overrides));
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
  });
});

/** An adapter that lost its in-memory quotes, as HttpFlashClient does across a backend restart. */
class RestartedFlash extends FakeFlash {
  hasQuote(): boolean {
    return false;
  }
}

function orderCount(db: Built["db"]) {
  return db.prepare("SELECT count(*) AS n FROM orders").get();
}

describe("B04-31 a quote the adapter no longer knows (backend restart)", () => {
  it("returns 409 QUOTE_EXPIRED before markUsed: submit is not called and the quote is not spent", async () => {
    const { app, db, flash } = await build(undefined, (clock) => new RestartedFlash(clock));
    const q = await quote(app);
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(flash.calls.filter((c) => c.method === "submit")).toEqual([]);
    expect(new QuotesRepo(db).get(q.quoteId)?.usedAt).toBeNull();
    expect(orderCount(db)).toEqual({ n: 0 });
  });
  it("FlashUnknownQuoteError from submit (lost between check and submit) is 409 QUOTE_EXPIRED; quote stays spent", async () => {
    const { app, db, flash } = await build();
    const q = await quote(app);
    flash.failNextSubmit = new FlashUnknownQuoteError(q.quoteId);
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(orderCount(db)).toEqual({ n: 0 });
    expect(new QuotesRepo(db).get(q.quoteId)?.usedAt).not.toBeNull();
  });
});

describe("B04-32 a non-Flash error from the adapter's submit() stays a 500", () => {
  it("TypeError is 500 INTERNAL 'Internal error', writes no order row, and the quote stays spent (pinned)", async () => {
    const { app, db, flash } = await build();
    const q = await quote(app);
    flash.failNextSubmit = new TypeError("bug in adapter");
    const res = await postOrder(app, orderBody(q.quoteId));
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(orderCount(db)).toEqual({ n: 0 });
    // markUsed ran before submit (D-B1) and the outcome at Flash is unknown, so the quote is never reused.
    await expectQuoteExpired(await postOrder(app, orderBody(q.quoteId)));
    expect(flash.calls.filter((c) => c.method === "submit")).toHaveLength(1);
  });
});
