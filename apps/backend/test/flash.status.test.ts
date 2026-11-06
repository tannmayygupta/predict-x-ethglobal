import { ApiError, FlashOrderDetail, FlashOrderResponse, FlashQuoteResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FlashError, FlashNotFoundError } from "../src/clients/flash.types";
import { OrdersRepo } from "../src/db/orders";
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
const ORDER_SIGNATURE = `0x${"ab".repeat(65)}`;

/** The app and its spy share one FakeClock so quote expiry and updatedAt follow built.clock. */
async function build() {
  const clock = new FakeClock();
  const flash = new FakeFlash(clock);
  built = await buildTestApp({ clock, flash });
  return { ...built, flash };
}

/** Quote plus order through the routes, so the status tests start from a real stored order. */
async function placeOrder(app: Built["app"], orderType: "market" | "limit" = "market"): Promise<string> {
  const payload = { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType, amount: "2.00", limitPriceUsd: "2380.00" };
  const quoted = await app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
  const { quoteId } = FlashQuoteResponse.parse(quoted.json());
  const order = { quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null };
  const submitted = await app.inject({ method: "POST", url: "/api/v1/flash/order", payload: order });
  expect(submitted.statusCode).toBe(200);
  return FlashOrderResponse.parse(submitted.json()).orderId;
}

async function getStatus(app: Built["app"], orderId: string) {
  return app.inject({ method: "GET", url: `/api/v1/flash/order/${orderId}` });
}

function statusCalls(flash: FakeFlash) {
  return flash.calls.filter((c) => c.method === "status");
}

describe("B04-22 GET /flash/order/:id for a known order", () => {
  it("asks Flash with the stored funder, persists the result, and returns FlashOrderDetail with the quote's orderType", async () => {
    const { app, db, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    const res = await getStatus(app, orderId);
    expect(res.statusCode).toBe(200);
    const detail = FlashOrderDetail.parse(res.json());
    expect(detail.orderId).toBe(orderId);
    expect(detail.orderType).toBe("limit");
    expect(detail.status).toBe("submitted");
    const call = statusCalls(flash)[0];
    expect(call?.method === "status" && call.input).toEqual({ orderId, orderType: "limit", funderAddress: WALLET });
    expect(new OrdersRepo(db).get(orderId)?.detail).toEqual(detail);
  });
});

describe("B04-23 unknown orderId", () => {
  it("returns 404 NOT_FOUND in ApiError shape without asking Flash", async () => {
    const { app, flash } = await build();
    const res = await getStatus(app, "o_missing");
    expect(res.statusCode).toBe(404);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("o_missing");
    expect(statusCalls(flash)).toEqual([]);
  });
});

describe("B04-24 terminal statuses are served from SQLite (D-B3)", () => {
  it.each(["filled", "failed", "expired"] as const)("stored %s: no Flash call, the stored row is returned", async (status) => {
    const { app, db, flash } = await build();
    const orderId = await placeOrder(app);
    const orders = new OrdersRepo(db);
    const stored = orders.get(orderId);
    expect(stored).toBeDefined();
    if (!stored) return;
    const terminal: FlashOrderDetail = { ...stored.detail, status, error: status === "filled" ? null : "REASON_X" };
    orders.updateDetail(orderId, terminal, stored.updatedAt);
    const before = statusCalls(flash).length;
    const res = await getStatus(app, orderId);
    expect(res.statusCode).toBe(200);
    expect(FlashOrderDetail.parse(res.json())).toEqual(terminal);
    expect(statusCalls(flash)).toHaveLength(before);
  });
});

describe("B04-25 non-terminal statuses are refreshed every time", () => {
  it("submitted then open (limit): two polls are two Flash calls, and the row follows", async () => {
    const { app, db, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    expect(FlashOrderDetail.parse((await getStatus(app, orderId)).json()).status).toBe("submitted");
    expect(FlashOrderDetail.parse((await getStatus(app, orderId)).json()).status).toBe("open");
    expect(FlashOrderDetail.parse((await getStatus(app, orderId)).json()).status).toBe("open");
    expect(statusCalls(flash)).toHaveLength(3);
    expect(new OrdersRepo(db).get(orderId)?.status).toBe("open");
  });
  it("a market order that fills stops being polled once stored as filled", async () => {
    const { app, flash } = await build();
    const orderId = await placeOrder(app, "market");
    await getStatus(app, orderId);
    const filled = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    expect(filled.status).toBe("filled");
    expect(filled.txHash).not.toBeNull();
    await getStatus(app, orderId);
    expect(statusCalls(flash)).toHaveLength(2);
  });
});

describe("B04-26 filled without a txHash is returned as-is", () => {
  it("txHash stays null (the backend never invents a hash; FR-S-06 is the frontend's call)", async () => {
    const { app, flash } = await build();
    const orderId = await placeOrder(app, "market");
    await getStatus(app, orderId);
    flash.patchNextStatus = { txHash: null };
    const detail = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    expect(detail.status).toBe("filled");
    expect(detail.txHash).toBeNull();
  });
});

describe("B04-27 transient Flash failures while polling (D-B2)", () => {
  it.each([
    ["FlashError('flash unavailable')", new FlashError("flash unavailable")],
    ["FlashNotFoundError (list lag right after submit, notes 4.3)", new FlashNotFoundError("order not found yet")],
  ])("%s returns 200 with the last stored detail and updatedAt unchanged", async (_name, failure) => {
    const { app, clock, db, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    const first = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    clock.advance(3);
    flash.failNextStatus = failure;
    const res = await getStatus(app, orderId);
    expect(res.statusCode).toBe(200);
    expect(FlashOrderDetail.parse(res.json())).toEqual(first);
    expect(new OrdersRepo(db).get(orderId)?.updatedAt).toBe(first.updatedAt);
    // The next poll recovers on its own.
    clock.advance(3);
    expect(FlashOrderDetail.parse((await getStatus(app, orderId)).json()).status).toBe("open");
  });
  it("a non-Flash error is still a 500 INTERNAL (only adapter failures are transient)", async () => {
    const { app, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    flash.failNextStatus = new TypeError("bug");
    const res = await getStatus(app, orderId);
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error.code).toBe("INTERNAL");
  });
});

describe("B04-28 updatedAt is the backend's refresh time", () => {
  it("equals clock.now() at the refresh even when Flash reports an older timestamp, and is persisted", async () => {
    const { app, clock, db, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    clock.advance(7);
    flash.patchNextStatus = { updatedAt: clock.now() - 100 };
    const detail = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    expect(detail.updatedAt).toBe(clock.now());
    expect(new OrdersRepo(db).get(orderId)?.updatedAt).toBe(clock.now());
  });
});

describe("B04-33 an unknown Flash status is failed but not terminal", () => {
  it("is served as failed with the raw value, and the next GET asks Flash again and follows the real status", async () => {
    const { app, db, flash } = await build();
    const orderId = await placeOrder(app, "limit");
    flash.patchNextStatus = { status: "failed", error: "unknown flash status: ORDER_STATUS_SOMETHING_NEW" };
    const first = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    expect(first).toMatchObject({ status: "failed", error: "unknown flash status: ORDER_STATUS_SOMETHING_NEW" });
    expect(new OrdersRepo(db).get(orderId)?.status).toBe("failed");
    const second = FlashOrderDetail.parse((await getStatus(app, orderId)).json());
    expect(statusCalls(flash)).toHaveLength(2);
    expect(second).toMatchObject({ status: "open", error: null });
  });
});
