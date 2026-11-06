import type { FlashOrderDetail, FlashQuoteResponse } from "@predictx/shared";
import { z } from "zod";
import type { Clock } from "../util/clock";
import { fromFlashOrder, fromFlashQuote, toFlashOrderBody, toFlashQuoteBody } from "./flash.map";
import {
  FlashError,
  FlashNotFoundError,
  FlashUnknownQuoteError,
  RawFlashOrder,
  RawFlashOrderResponse,
  RawFlashQuote,
  type FlashClient,
  type FlashOrderResponse,
  type FlashQuoteInput,
  type FlashStatusInput,
  type FlashSubmitInput,
  type StoredFlashQuote,
} from "./flash.types";

export type FetchLike = typeof globalThis.fetch;

export interface HttpFlashClientOptions {
  baseUrl: string;
  apiKey: string;
  clock: Clock;
  fetchImpl: FetchLike;
  timeoutMs?: number;
}

/** Flash quotes answer in well under a second; a slow reply would expire our 60 s quote anyway (B03-21). */
const REQUEST_TIMEOUT_MS = 5_000;

/** Header name from docs/notes/flash-api.md section 1. */
const API_KEY_HEADER = "x-definitive-api-key";
const QUOTE_PATH = "/quote";
const ORDER_PATH = "/order";
/** Plural, unlike the submit path (notes section 5). */
const ORDERS_PATH = "/orders";

interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

interface RequestSpec<T> {
  method: "GET" | "POST";
  path: string;
  body?: object;
  /** What the call is, for error messages ("quote", "order"); never includes request data. */
  what: string;
  parser: Parser<T>;
}

/** Real Definitive Flash adapter. fetch is injected so unit tests replay recorded fixtures (X-04). */
export class HttpFlashClient implements FlashClient {
  /**
   * Flash wants the original trade fields back on /order, and the quotes table keeps only our response
   * and the typed data, so the body is remembered here for the quote's 60 s lifetime.
   */
  private readonly quotes = new Map<string, { stored: StoredFlashQuote; expiresAt: number }>();

  constructor(private readonly options: HttpFlashClientOptions) {}

  async quote(input: FlashQuoteInput): Promise<FlashQuoteResponse> {
    const body = toFlashQuoteBody(input.request, input.token);
    const raw = await this.request({ method: "POST", path: QUOTE_PATH, body, what: "quote", parser: RawFlashQuote });
    const quote = fromFlashQuote(raw, input, this.options.clock.now());
    this.remember(
      {
        quoteId: quote.quoteId,
        body,
        rawTypedData: { orderTypedData: quote.steps.orderTypedData, permitTypedData: quote.steps.permitTypedData },
      },
      quote.expiresAt,
    );
    return quote;
  }

  async submit({ quote, rawTypedData, order }: FlashSubmitInput): Promise<FlashOrderResponse> {
    const entry = this.quotes.get(quote.quoteId);
    if (entry === undefined) throw new FlashUnknownQuoteError(quote.quoteId);
    // The caller's typed data comes from the quotes table, the persisted byte-for-byte copy (B01-25).
    const body = toFlashOrderBody({ ...entry.stored, rawTypedData }, order);
    const raw = await this.request({
      method: "POST",
      path: ORDER_PATH,
      body,
      what: "order",
      parser: RawFlashOrderResponse,
    });
    return { orderId: raw.orderId, status: "submitted" };
  }

  /** FlashService asks before spending the quote, so a restart costs the user a re-quote, not a quote. */
  hasQuote(quoteId: string): boolean {
    return this.quotes.has(quoteId);
  }

  async status(input: FlashStatusInput): Promise<FlashOrderDetail> {
    const query = new URLSearchParams({ funderAddress: input.funderAddress });
    const raw = await this.request({
      method: "GET",
      path: `${ORDERS_PATH}/${encodeURIComponent(input.orderId)}?${query.toString()}`,
      what: "order status",
      parser: RawFlashOrder,
    });
    return fromFlashOrder(raw, input, this.options.clock.now());
  }

  private remember(stored: StoredFlashQuote, expiresAt: number): void {
    const now = this.options.clock.now();
    for (const [id, entry] of this.quotes) if (entry.expiresAt <= now) this.quotes.delete(id);
    this.quotes.set(stored.quoteId, { stored, expiresAt });
  }

  private async request<T>(spec: RequestSpec<T>): Promise<T> {
    const init: RequestInit = {
      method: spec.method,
      headers: { [API_KEY_HEADER]: this.options.apiKey, "content-type": "application/json" },
    };
    if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
    // A plain timer, not AbortSignal.timeout(), so tests can drive it with fake timers.
    const timeoutMs = this.options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;
    let response: Response;
    let text: string;
    try {
      response = await this.options.fetchImpl(`${this.options.baseUrl}${spec.path}`, init);
      text = await response.text();
    } catch (err) {
      if (controller.signal.aborted) throw new FlashError(`flash timed out after ${timeoutMs} ms`, { cause: err });
      // DNS, TLS, reset, or a dropped body: nothing Flash said, so nothing to relay (B03-19).
      throw new FlashError(UNAVAILABLE_MESSAGE, { cause: err });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw upstreamError(response.status, text, this.options.apiKey);
    const parsed = spec.parser.safeParse(parseJson(text));
    if (!parsed.success) throw new FlashError(`flash returned an unexpected ${spec.what} body`);
    return parsed.data;
  }
}

const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR_MIN = 500;
const UNAVAILABLE_MESSAGE = "flash unavailable";
const CENSOR = "[redacted]";
/** Enough of a text/plain body to recognise it in a log line without echoing a whole HTML page. */
const MAX_REASON_LENGTH = 200;

/** Documented `{ error: { code, message } }`, observed bare `{ error: "..." }`, and text/plain (notes section 6). */
const RawFlashErrorBody = z.object({
  error: z.union([z.object({ code: z.string(), message: z.string() }), z.string()]),
});

function upstreamReason(status: number, text: string): string {
  const parsed = RawFlashErrorBody.safeParse(parseJson(text));
  if (parsed.success) {
    const { error } = parsed.data;
    return typeof error === "string" ? error : `${error.code}: ${error.message}`;
  }
  return `flash http ${status}: ${text.trim().slice(0, MAX_REASON_LENGTH)}`;
}

/** The key only travels in a header, but an upstream that echoes it must not reach our logs or clients (RULES 2.1). */
function scrub(text: string, apiKey: string): string {
  return apiKey.length > 0 ? text.split(apiKey).join(CENSOR) : text;
}

function upstreamError(status: number, text: string, apiKey: string): FlashError {
  // A 5xx says nothing about our request; the user retries, and the reason stays out of the message.
  if (status >= HTTP_SERVER_ERROR_MIN) return new FlashError(UNAVAILABLE_MESSAGE);
  const reason = scrub(upstreamReason(status, text), apiKey);
  return status === HTTP_NOT_FOUND ? new FlashNotFoundError(reason) : new FlashError(reason);
}

/** Flash answers some failures in text/plain (notes section 6); an unparsable body is handled by the caller. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
