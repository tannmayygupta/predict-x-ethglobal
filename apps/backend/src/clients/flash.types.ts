import type {
  FlashOrderDetail,
  FlashOrderRequest,
  FlashQuoteRequest,
  FlashQuoteResponse,
  OrderType,
  Token,
} from "@predictx/shared";
import { z } from "zod";

export type OrderTypeName = z.infer<typeof OrderType>;

/** Flash returns no expiry; API_CONTRACT section 6 fixes ours at quote time + 60 s. */
export const QUOTE_TTL_SECONDS = 60;

/** Flash typed-data strings as returned by Flash; stored and echoed byte-for-byte (RULES 4.4). */
export interface RawTypedData {
  orderTypedData: string;
  permitTypedData: string | null;
}

export interface FlashQuoteInput {
  request: FlashQuoteRequest;
  token: Token;
}

export interface FlashSubmitInput {
  quote: FlashQuoteResponse;
  rawTypedData: RawTypedData;
  order: FlashOrderRequest;
}

export interface FlashStatusInput {
  orderId: string;
  orderType: OrderTypeName;
  /** Flash's GET /orders/{id} rejects the call without the funder (notes section 5). */
  funderAddress: string;
}

/** Adapter boundary for Definitive Flash: MockFlashClient (flash.mock.ts) or HttpFlashClient (flash.http.ts). */
export interface FlashClient {
  quote(input: FlashQuoteInput): Promise<FlashQuoteResponse>;
  submit(input: FlashSubmitInput): Promise<FlashOrderResponse>;
  status(input: FlashStatusInput): Promise<FlashOrderDetail>;
  /**
   * False when the adapter cannot submit this quote, e.g. HttpFlashClient after a restart lost its in-memory
   * quote bodies. Adapters without the method (the mock) know every quote they issued.
   */
  hasQuote?(quoteId: string): boolean;
}

export type FlashOrderResponse = { orderId: string; status: "submitted" };

export class FlashError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FlashError";
  }
}

/** Flash knows no such order (HTTP 404 or an unknown mock id); routes map it to NOT_FOUND, not FLASH_ERROR. */
export class FlashNotFoundError extends FlashError {
  constructor(message: string) {
    super(message);
    this.name = "FlashNotFoundError";
  }
}

/** The adapter no longer holds this quote (restart); routes map it to QUOTE_EXPIRED so the client re-quotes. */
export class FlashUnknownQuoteError extends FlashError {
  constructor(quoteId: string) {
    super(`quote ${quoteId} is not known to this backend; request a new quote`);
    this.name = "FlashUnknownQuoteError";
  }
}

/* ---------- Flash wire shapes (docs/notes/flash-api.md sections 3 and 4) ---------- */

/** Body of POST /v1/quote. Optional keys are omitted, never null: Flash rejects a limit price on market orders. */
export interface FlashQuoteBody {
  targetChain: string;
  contraChain: string;
  targetAsset: string;
  contraAsset: string;
  side: "buy";
  qty: string;
  orderType: OrderTypeName;
  funderAddress: string;
  maxSlippage?: string;
  limitNotionalPrice?: string;
}

/** Body of POST /v1/order: the full quote body resent plus the signed payload (notes section 4.1). */
export interface FlashOrderBody extends FlashQuoteBody {
  quoteId: string;
  userSignature: string;
  evmOrderTypedData: string;
  evmPermitTypedData?: string;
  evmPermitSignature?: string;
}

/** What the HTTP client must remember between quote and submit: Flash wants the original trade fields back. */
export interface StoredFlashQuote {
  quoteId: string;
  body: FlashQuoteBody;
  rawTypedData: RawTypedData;
}

/** POST /v1/quote response, only the keys we read; zod strips the rest (notes section 3.2). */
export const RawFlashQuote = z.object({
  quoteId: z.string(),
  from: z.object({ amount: z.string() }),
  to: z.object({ amount: z.string() }),
  fees: z.object({ estimatedFeeNotional: z.string() }),
  estimatedPriceImpact: z.string().nullable(),
  evm: z
    .object({
      approveTx: z.object({ to: z.string(), data: z.string() }).nullable(),
      permitTypedData: z.string().nullable(),
      orderTypedData: z.string().nullable(),
    })
    .nullable(),
});
export type RawFlashQuote = z.infer<typeof RawFlashQuote>;

/** POST /v1/order response (HTTP 201); only orderId is documented (notes section 4.2). */
export const RawFlashOrderResponse = z.object({ orderId: z.string() });
export type RawFlashOrderResponse = z.infer<typeof RawFlashOrderResponse>;

const IsoTimestamp = z.string().nullable().optional();

/**
 * GET /v1/orders/{id} response, only the keys we read (notes section 5.1). The docs publish no literal
 * example, so every optional key is tolerated as missing. GATE0: confirm against a real order body.
 */
export const RawFlashOrder = z.object({
  order: z.object({
    orderId: z.string(),
    status: z.string(),
    closeReason: z.string().nullable().optional(),
    filled: z
      .object({ targetAmount: z.string().nullable().optional(), contraAmount: z.string().nullable().optional() })
      .nullable()
      .optional(),
    placedAt: IsoTimestamp,
    acceptedAt: IsoTimestamp,
    closedAt: IsoTimestamp,
  }),
  fills: z.array(z.object({ transactionId: z.string().nullable().optional() })).default([]),
});
export type RawFlashOrder = z.infer<typeof RawFlashOrder>;
