import { ApiError, FlashOrderResponse, FlashQuoteResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ORDERS_DISABLED_MESSAGE } from "../src/services/flash";
import { buildTestApp } from "./helpers/build";
import { envWith } from "./helpers/env";
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

/** Real-mode flags with the spy standing in for Flash: no network, no funds. */
async function build(env: Record<string, string>) {
  const clock = new FakeClock();
  const flash = new FakeFlash(clock);
  built = await buildTestApp({ clock, flash, env: { FLASH_MOCK: "false", FLASH_API_KEY: "dpka_test", ...env } });
  return { app: built.app, flash };
}

async function quote(app: Built["app"]): Promise<FlashQuoteResponse> {
  const payload = { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "2.00" };
  const res = await app.inject({ method: "POST", url: "/api/v1/flash/quote", payload });
  expect(res.statusCode).toBe(200);
  return FlashQuoteResponse.parse(res.json());
}

function order(app: Built["app"], quoteId: string) {
  const payload = { quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null };
  return app.inject({ method: "POST", url: "/api/v1/flash/order", payload });
}

describe("FLASH_ORDERS_ENABLED guard", () => {
  it("defaults to false", () => {
    expect(loadConfig(envWith({})).flashOrdersEnabled).toBe(false);
    expect(loadConfig(envWith({ FLASH_ORDERS_ENABLED: "true" })).flashOrdersEnabled).toBe(true);
  });

  it("real mode without the flag: quotes work, orders are refused with FLASH_ERROR and Flash is never called", async () => {
    const { app, flash } = await build({});
    const q = await quote(app);
    const res = await order(app, q.quoteId);
    expect(res.statusCode).toBe(502);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe("FLASH_ERROR");
    expect(body.error.message).toBe(ORDERS_DISABLED_MESSAGE);
    expect(flash.calls.some((c) => c.method === "submit")).toBe(false);
  });

  it("a refused order does not spend the quote", async () => {
    const { app } = await build({});
    const q = await quote(app);
    await order(app, q.quoteId);
    const again = await order(app, q.quoteId);
    expect(ApiError.parse(again.json()).error.message).toBe(ORDERS_DISABLED_MESSAGE);
  });

  it("real mode with FLASH_ORDERS_ENABLED=true: the order is submitted", async () => {
    const { app, flash } = await build({ FLASH_ORDERS_ENABLED: "true" });
    const q = await quote(app);
    const res = await order(app, q.quoteId);
    expect(res.statusCode).toBe(200);
    expect(FlashOrderResponse.parse(res.json()).status).toBe("submitted");
    expect(flash.calls.some((c) => c.method === "submit")).toBe(true);
  });

  it("mock mode keeps accepting orders (they move no funds)", async () => {
    const { app } = await build({ FLASH_MOCK: "true" });
    const q = await quote(app);
    expect((await order(app, q.quoteId)).statusCode).toBe(200);
  });
});
