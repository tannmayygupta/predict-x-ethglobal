import { ApiError, FlashOrderDetail, FlashOrderResponse, FlashQuoteResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { FlashError, type FlashQuoteInput } from "../../src/clients/flash.types";
import { buildTestApp } from "../helpers/build";
import { FakeClock } from "../helpers/fakes/clock";
import { FakeFlash } from "../helpers/fakes/flashSpy";

/**
 * T-B04's rows of the FR-B-01 contract table (B04-29) and the FR-B-07 error table (B04-30) for the
 * three Flash endpoints. Shapes come only from @predictx/shared (X-05).
 */
type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const WALLET = "0x1111111111111111111111111111111111111111";
const ORDER_SIGNATURE = `0x${"ab".repeat(65)}`;
const QUOTE_BODY = { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "2.00" };

async function build(flash: FakeFlash = new FakeFlash()) {
  const clock = new FakeClock();
  built = await buildTestApp({ clock, flash });
  return { ...built, flash };
}

interface Request {
  method: "GET" | "POST";
  url: string;
  payload?: Record<string, unknown>;
}

/** The canonical quote -> order chain; each row picks the request it needs from the ids it produced. */
async function placeOrder(app: Built["app"]): Promise<{ quoteId: string; orderId: string }> {
  const quoted = await app.inject({ method: "POST", url: "/api/v1/flash/quote", payload: QUOTE_BODY });
  const { quoteId } = FlashQuoteResponse.parse(quoted.json());
  const order = { quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null };
  const submitted = await app.inject({ method: "POST", url: "/api/v1/flash/order", payload: order });
  const { orderId } = FlashOrderResponse.parse(submitted.json());
  return { quoteId, orderId };
}

type Ids = Awaited<ReturnType<typeof placeOrder>>;

interface ContractRow {
  name: string;
  request: (app: Built["app"]) => Promise<Request>;
  schema: { safeParse(data: unknown): { success: boolean }; parse(data: unknown): unknown };
}

const rows: ContractRow[] = [
  {
    name: "POST /flash/quote",
    request: async () => ({ method: "POST", url: "/api/v1/flash/quote", payload: QUOTE_BODY }),
    schema: FlashQuoteResponse,
  },
  {
    name: "POST /flash/order",
    request: async (app) => {
      const quoted = await app.inject({ method: "POST", url: "/api/v1/flash/quote", payload: QUOTE_BODY });
      const { quoteId } = FlashQuoteResponse.parse(quoted.json());
      const payload = { quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null };
      return { method: "POST", url: "/api/v1/flash/order", payload };
    },
    schema: FlashOrderResponse,
  },
  {
    name: "GET /flash/order/:orderId",
    request: async (app) => ({ method: "GET", url: `/api/v1/flash/order/${(await placeOrder(app)).orderId}` }),
    schema: FlashOrderDetail,
  },
];

describe("B04-29 flash endpoints parse with their shared schemas (FR-B-01)", () => {
  it.each(rows)("$name", async ({ request, schema }) => {
    const { app } = await build();
    const { method, url, payload } = await request(app);
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body: unknown = res.json();
    expect(schema.safeParse(body).success).toBe(true);
    // The parsed value equals the raw body: nothing is stripped or defaulted on the way out.
    expect(schema.parse(body)).toEqual(body);
  });
});

/** Returns a quote the response schema rejects: the contract allows only non-negative price impact. */
class MalformedQuoteFlash extends FakeFlash {
  override async quote(input: FlashQuoteInput): Promise<FlashQuoteResponse> {
    return { ...(await super.quote(input)), estimatedPriceImpact: "-0.5" };
  }
}

interface ErrorRow {
  code: string;
  status: number;
  flash?: () => FakeFlash;
  request: (app: Built["app"], ids: Ids) => Promise<Request> | Request;
  /** Requests sent first from the same IP, for the rate limit row. */
  warmup?: number;
}

const errorRows: ErrorRow[] = [
  {
    code: "BAD_REQUEST",
    status: 400,
    request: () => ({ method: "POST", url: "/api/v1/flash/quote", payload: {} }),
  },
  {
    code: "UNSUPPORTED_TOKEN",
    status: 400,
    request: () => ({ method: "POST", url: "/api/v1/flash/quote", payload: { ...QUOTE_BODY, symbol: "DOGE" } }),
  },
  {
    code: "NOT_FOUND",
    status: 404,
    request: () => ({ method: "GET", url: "/api/v1/flash/order/o_missing" }),
  },
  {
    code: "QUOTE_EXPIRED",
    status: 409,
    request: (_app, ids) => ({
      method: "POST",
      url: "/api/v1/flash/order",
      // The chain already spent this quote: single-use (D-B1).
      payload: { quoteId: ids.quoteId, walletAddress: WALLET, orderSignature: ORDER_SIGNATURE, permitSignature: null },
    }),
  },
  {
    code: "RATE_LIMITED",
    status: 429,
    warmup: 60,
    request: (_app, ids) => ({ method: "GET", url: `/api/v1/flash/order/${ids.orderId}` }),
  },
  {
    code: "FLASH_ERROR",
    status: 502,
    flash: () => {
      const flash = new FakeFlash();
      flash.failNextQuoteWith = new FlashError("insufficient liquidity");
      return flash;
    },
    request: () => ({ method: "POST", url: "/api/v1/flash/quote", payload: QUOTE_BODY }),
  },
  {
    code: "INTERNAL",
    status: 500,
    flash: () => new MalformedQuoteFlash(),
    request: () => ({ method: "POST", url: "/api/v1/flash/quote", payload: QUOTE_BODY }),
  },
];

const CLIENT_IP = "10.0.0.9";

describe("B04-30 every error code reachable through the flash endpoints parses with ApiError (FR-B-07)", () => {
  it.each(errorRows)("$code ($status)", async ({ code, status, flash, request, warmup = 0 }) => {
    const { app, db } = await build(flash?.());
    const ids = flash ? { quoteId: "", orderId: "" } : await placeOrder(app);
    const req = await request(app, ids);
    for (let i = 0; i < warmup; i += 1) {
      const res = await app.inject({ ...req, remoteAddress: CLIENT_IP });
      expect(res.statusCode).not.toBe(429);
    }
    const res = await app.inject({ ...req, remoteAddress: CLIENT_IP });
    expect(res.statusCode).toBe(status);
    expect(res.headers["content-type"]).toContain("application/json");
    const body: unknown = res.json();
    expect(ApiError.parse(body).error.code).toBe(code);
    expect(ApiError.parse(body)).toEqual(body);
    if (code === "INTERNAL") {
      // A quote the contract rejects must not be stored either, or /flash/order would read a corrupt row.
      expect(db.prepare("SELECT count(*) AS n FROM quotes").get()).toEqual({ n: 0 });
    }
  });

  it("LLM_UNAVAILABLE is the one code no flash endpoint can produce (it belongs to /insight)", () => {
    expect(errorRows.map((r) => r.code).sort()).toEqual(
      ["BAD_REQUEST", "FLASH_ERROR", "INTERNAL", "NOT_FOUND", "QUOTE_EXPIRED", "RATE_LIMITED", "UNSUPPORTED_TOKEN"].sort(),
    );
  });
});
