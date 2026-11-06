import {
  FLASH_BASE_ASSETS,
  FlashOrderDetail,
  FlashQuoteResponse,
  OrderStatus,
  Token,
  type FlashQuoteRequest,
} from "@predictx/shared";
import { describe, expect, it } from "vitest";
import tokensJson from "../../../../packages/shared/tokens.json";
import {
  fromFlashOrder,
  fromFlashQuote,
  isUnknownFlashStatus,
  mapFlashStatus,
  toFlashOrderBody,
  toFlashQuoteBody,
} from "../../src/clients/flash.map";
import {
  FlashError,
  type RawFlashOrder,
  type RawFlashQuote,
  type StoredFlashQuote,
} from "../../src/clients/flash.types";

const ETH = Token.parse(tokensJson.tokens.find((t) => t.symbol === "ETH"));
const WALLET = "0x1111111111111111111111111111111111111111";

const marketReq: FlashQuoteRequest = {
  walletAddress: WALLET,
  symbol: "ETH",
  side: "buy",
  orderType: "market",
  amount: "2.00",
  slippage: "0.01",
};
const limitReq: FlashQuoteRequest = { ...marketReq, orderType: "limit", limitPriceUsd: "2380.00" };

describe("B03-08 toFlashQuoteBody", () => {
  it.each([
    [
      "market",
      marketReq,
      {
        targetChain: "base",
        contraChain: "base",
        targetAsset: ETH.address,
        contraAsset: FLASH_BASE_ASSETS.USDC,
        side: "buy",
        qty: "2.00",
        orderType: "market",
        maxSlippage: "0.01",
        funderAddress: WALLET,
      },
    ],
    [
      "limit",
      limitReq,
      {
        targetChain: "base",
        contraChain: "base",
        targetAsset: ETH.address,
        contraAsset: FLASH_BASE_ASSETS.USDC,
        side: "buy",
        qty: "2.00",
        orderType: "limit",
        limitNotionalPrice: "2380.00",
        funderAddress: WALLET,
      },
    ],
  ])("maps a %s request field by field", (_name, request, expected) => {
    expect(toFlashQuoteBody(request, ETH)).toStrictEqual(expected);
  });
});

describe("B03-09 keys that must be omitted, not null", () => {
  it("market has no limitNotionalPrice key; limit has no maxSlippage key (GATE0: confirm)", () => {
    const market = toFlashQuoteBody(marketReq, ETH);
    expect(Object.keys(market)).not.toContain("limitNotionalPrice");
    expect(JSON.stringify(market)).not.toContain("limitNotionalPrice");
    const limit = toFlashQuoteBody(limitReq, ETH);
    expect(Object.keys(limit)).not.toContain("maxSlippage");
  });
});

const ORDER_TYPED_DATA =
  '{"types":{"EIP712Domain":[{"name":"name","type":"string"}],"FlashOrder":[{"name":"swapper","type":"address"}]},' +
  '"primaryType":"FlashOrder","domain":{"name":"DefinitiveFlashAllowance","version":"1","chainId":"8453",' +
  '"verifyingContract":"0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78"},"message":{"swapper":"' +
  WALLET +
  '","fromAmount":"2000000","deadline":"1761600300"}}';
const PERMIT_TYPED_DATA = '{"types":{"PermitSingle":[]},"primaryType":"PermitSingle","domain":{},"message":{}}';

function rawQuote(overrides: Partial<RawFlashQuote["evm"]> = {}): RawFlashQuote {
  return {
    quoteId: "336d48fe-3dfb-4bf6-8300-d3b88aaf23c8",
    from: { amount: "2" },
    to: { amount: "0.000839667739435631" },
    fees: { estimatedFeeNotional: "0" },
    estimatedPriceImpact: "0.0003405",
    evm: {
      approveTx: { to: FLASH_BASE_ASSETS.USDC, data: "0x095ea7b3" },
      permitTypedData: "",
      orderTypedData: ORDER_TYPED_DATA,
      ...overrides,
    },
  };
}

const NOW = 1_761_600_000;
const MARKET_INPUT = { request: marketReq, token: ETH };

describe("B03-10 fromFlashQuote steps", () => {
  it("maps evm.approveTx / permitTypedData / orderTypedData into steps with the same string instances", () => {
    const raw = rawQuote();
    const quote = fromFlashQuote(raw, MARKET_INPUT, NOW);
    expect(quote.steps.orderTypedData).toBe(raw.evm?.orderTypedData);
    expect(quote.steps.approveTx).toEqual({ to: FLASH_BASE_ASSETS.USDC, data: "0x095ea7b3" });
    // Flash sends "" when Permit2 is unused; the contract says null.
    expect(quote.steps.permitTypedData).toBeNull();
  });

  it("keeps a non-empty permitTypedData string unchanged and a null approveTx as null", () => {
    const raw = rawQuote({ permitTypedData: PERMIT_TYPED_DATA, approveTx: null });
    const quote = fromFlashQuote(raw, MARKET_INPUT, NOW);
    expect(quote.steps.permitTypedData).toBe(raw.evm?.permitTypedData);
    expect(quote.steps.approveTx).toBeNull();
  });

  it("throws FlashError when Flash returns no orderTypedData (funderAddress missing upstream)", () => {
    expect(() => fromFlashQuote(rawQuote({ orderTypedData: "" }), MARKET_INPUT, NOW)).toThrow(FlashError);
    expect(() => fromFlashQuote({ ...rawQuote(), evm: null }, MARKET_INPUT, NOW)).toThrow(/orderTypedData/);
  });
});

describe("B03-11 fromFlashQuote expiry", () => {
  it("sets expiresAt = now + 60 because Flash returns no expiry field", () => {
    const quote = fromFlashQuote(rawQuote(), MARKET_INPUT, NOW);
    expect(quote.expiresAt).toBe(NOW + 60);
    const later = fromFlashQuote(rawQuote(), MARKET_INPUT, NOW + 1_000);
    expect(later.expiresAt).toBe(NOW + 1_060);
  });
});

describe("B03-12 fromFlashQuote shape", () => {
  it("parses with FlashQuoteResponse with chain base / 8453 and the amounts taken from from/to/fees", () => {
    const raw = rawQuote();
    const quote = FlashQuoteResponse.parse(fromFlashQuote(raw, MARKET_INPUT, NOW));
    expect(quote.chain).toBe("base");
    expect(quote.chainId).toBe(8453);
    expect(quote.quoteId).toBe(raw.quoteId);
    expect(quote.side).toBe("buy");
    expect(quote.orderType).toBe("market");
    expect(quote.spend).toEqual({ symbol: "USDC", amount: "2" });
    expect(quote.receive).toEqual({ symbol: "ETH", amount: "0.000839667739435631" });
    expect(quote.feesUsd).toBe("0");
    expect(quote.estimatedPriceImpact).toBe("0.0003405");
  });

  it("keeps a null estimatedPriceImpact and carries the request orderType for limit quotes", () => {
    const raw = { ...rawQuote(), estimatedPriceImpact: null };
    const quote = FlashQuoteResponse.parse(fromFlashQuote(raw, { request: limitReq, token: ETH }, NOW));
    expect(quote.estimatedPriceImpact).toBeNull();
    expect(quote.orderType).toBe("limit");
  });
});

const ORDER_SIG = "0xaaaa";
const PERMIT_SIG = "0xbbbb";

function storedQuote(permitTypedData: string | null): StoredFlashQuote {
  return {
    quoteId: "336d48fe-3dfb-4bf6-8300-d3b88aaf23c8",
    body: toFlashQuoteBody(marketReq, ETH),
    rawTypedData: { orderTypedData: ORDER_TYPED_DATA, permitTypedData },
  };
}

function orderReq(stored: StoredFlashQuote, permitSignature?: string | null) {
  return { quoteId: stored.quoteId, walletAddress: WALLET, orderSignature: ORDER_SIG, permitSignature };
}

describe("B03-13 toFlashOrderBody", () => {
  it("resends the quote's trade fields with quoteId, userSignature and the untouched evmOrderTypedData", () => {
    const stored = storedQuote(null);
    const body = toFlashOrderBody(stored, orderReq(stored, null));
    expect(body).toStrictEqual({
      ...stored.body,
      quoteId: stored.quoteId,
      userSignature: ORDER_SIG,
      evmOrderTypedData: ORDER_TYPED_DATA,
    });
    expect(body.evmOrderTypedData).toBe(stored.rawTypedData.orderTypedData);
    expect(Object.keys(body)).not.toContain("evmPermitTypedData");
    expect(Object.keys(body)).not.toContain("evmPermitSignature");
  });

  it("adds evmPermitTypedData and evmPermitSignature only when the quote carried a permit", () => {
    const stored = storedQuote(PERMIT_TYPED_DATA);
    const body = toFlashOrderBody(stored, orderReq(stored, PERMIT_SIG));
    expect(body.evmPermitTypedData).toBe(stored.rawTypedData.permitTypedData);
    expect(body.evmPermitSignature).toBe(PERMIT_SIG);
  });

  it("throws FlashError when the quote needs a permit but no permitSignature was sent", () => {
    const stored = storedQuote(PERMIT_TYPED_DATA);
    const attempt = (): unknown => toFlashOrderBody(stored, orderReq(stored));
    expect(attempt).toThrow(FlashError);
    expect(attempt).toThrow(/permitSignature/);
  });
});

describe("B03-14 mapFlashStatus", () => {
  it.each([
    ["ORDER_STATUS_UNSPECIFIED", null, "submitted", null],
    ["ORDER_STATUS_PENDING", null, "submitted", null],
    ["ORDER_STATUS_ACCEPTED", null, "open", null],
    ["ORDER_STATUS_PARTIALLY_FILLED", null, "open", null],
    ["ORDER_STATUS_FILLED", "REASON_FULLY_FILLED", "filled", null],
    ["ORDER_STATUS_CANCELLED", "REASON_ORDER_EXPIRED", "expired", "REASON_ORDER_EXPIRED"],
    ["ORDER_STATUS_CANCELLED", "REASON_USER_REQUESTED", "failed", "REASON_USER_REQUESTED"],
    ["ORDER_STATUS_CANCELLED", null, "failed", "ORDER_STATUS_CANCELLED"],
    ["ORDER_STATUS_REJECTED", "REASON_MAXIMUM_SLIPPAGE_EXCEEDED", "failed", "REASON_MAXIMUM_SLIPPAGE_EXCEEDED"],
    ["ORDER_STATUS_REJECTED", null, "failed", "ORDER_STATUS_REJECTED"],
    ["ORDER_STATUS_TERMINATED", "REASON_ORDER_EXPIRED", "expired", "REASON_ORDER_EXPIRED"],
    ["ORDER_STATUS_TERMINATED", null, "failed", "ORDER_STATUS_TERMINATED"],
  ])("%s with closeReason %s -> %s", (raw, closeReason, status, error) => {
    expect(mapFlashStatus(raw, closeReason)).toStrictEqual({ status: OrderStatus.parse(status), error });
  });

  it("never throws: an unknown value maps to failed with an explanatory error", () => {
    expect(mapFlashStatus("ORDER_STATUS_SOMETHING_NEW", null)).toStrictEqual({
      status: "failed",
      error: "unknown flash status: ORDER_STATUS_SOMETHING_NEW",
    });
    expect(mapFlashStatus("", "REASON_USER_REQUESTED")).toStrictEqual({
      status: "failed",
      error: "unknown flash status: ",
    });
  });

  it("isUnknownFlashStatus marks only the unknown-status failure as not terminal (D-B3 re-polls it)", () => {
    expect(isUnknownFlashStatus(mapFlashStatus("ORDER_STATUS_SOMETHING_NEW", null))).toBe(true);
    expect(isUnknownFlashStatus(mapFlashStatus("ORDER_STATUS_REJECTED", "REASON_X"))).toBe(false);
    expect(isUnknownFlashStatus({ status: "open", error: null })).toBe(false);
  });
});

const STATUS_INPUT = { orderId: "7f0c1b2e-5a3d-4c1e-9b7a-2d4f6e8a1c3b", orderType: "market", funderAddress: WALLET } as const;

/** Optional keys stay absent on purpose: the schema tolerates a Flash body that omits them. */
function rawOrder(overrides: Partial<RawFlashOrder["order"]>, fills: RawFlashOrder["fills"] = []): RawFlashOrder {
  return { order: { orderId: STATUS_INPUT.orderId, status: "ORDER_STATUS_PENDING", ...overrides }, fills };
}

describe("B03-17 fromFlashOrder (pure)", () => {
  it("falls back to `now` when Flash sends no timestamps and ignores fills without a transactionId", () => {
    const detail = fromFlashOrder(rawOrder({}, [{ transactionId: null }, { transactionId: "" }]), STATUS_INPUT, NOW);
    expect(FlashOrderDetail.parse(detail)).toStrictEqual({
      orderId: STATUS_INPUT.orderId,
      status: "submitted",
      orderType: "market",
      txHash: null,
      chainId: 8453,
      filledAmount: null,
      error: null,
      updatedAt: NOW,
    });
  });

  it("takes the latest fill's transactionId and prefers closedAt over acceptedAt and placedAt", () => {
    const raw = rawOrder(
      {
        status: "ORDER_STATUS_FILLED",
        closeReason: "REASON_FULLY_FILLED",
        filled: { targetAmount: "0.000839", contraAmount: "2" },
        placedAt: "2025-10-27T22:00:00Z",
        acceptedAt: "2025-10-27T22:00:01Z",
        closedAt: "2025-10-27T22:00:30Z",
      },
      [{ transactionId: "0x1111" }, { transactionId: "0x2222" }],
    );
    const detail = fromFlashOrder(raw, STATUS_INPUT, NOW);
    expect(detail.txHash).toBe("0x2222");
    expect(detail.filledAmount).toBe("0.000839");
    expect(detail.updatedAt).toBe(1_761_602_430);
  });

  it("surfaces a failed order's closeReason as error and an unknown status without throwing", () => {
    const raw = rawOrder({ status: "ORDER_STATUS_REJECTED", closeReason: "REASON_MAXIMUM_SLIPPAGE_EXCEEDED" });
    const rejected = fromFlashOrder(raw, STATUS_INPUT, NOW);
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toBe("REASON_MAXIMUM_SLIPPAGE_EXCEEDED");
    const unknown = fromFlashOrder(rawOrder({ status: "ORDER_STATUS_NEW_THING" }), STATUS_INPUT, NOW);
    expect(unknown.status).toBe("failed");
    expect(unknown.error).toBe("unknown flash status: ORDER_STATUS_NEW_THING");
  });
});
