import { z } from "zod";
import type { Config } from "../config";
import { numberToDecimalString } from "../util/decimal";
import { PriceSourceError, type CoinMarket, type PriceSource, type RawChartPoint } from "./priceSource";

/** Demo and keyless plans share this root; the paid plan lives on pro-api (docs/notes/coingecko-api.md section 1). */
export const COINGECKO_DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";
const PRO_HOST = "pro-api.coingecko.com";
const DEMO_KEY_HEADER = "x-cg-demo-api-key";
const PRO_KEY_HEADER = "x-cg-pro-api-key";
const VS_CURRENCY = "usd";
/** Without this CoinGecko rounds PEPE-scale prices (5.0079e-06 becomes 5.0e-06), useless against a strike. */
const PRICE_PRECISION = "full";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY = 429;
const MS_PER_SECOND = 1000;
/** 250 is the endpoint maximum; the allowlist is far smaller, so one page always holds every id. */
const MARKETS_PER_PAGE = 250;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
/** A bogus huge Retry-After must not park the backend for hours. */
const MAX_RETRY_AFTER_SECONDS = 600;
/** TEST_PLAN B02-17: a hover card waiting longer than this should show the stale price instead. */
export const COINGECKO_TIMEOUT_MS = 3000;

export interface CoinGeckoOptions {
  /** Empty means keyless: no auth header at all (an invalid key is rejected, it does not fall back). */
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Injected clock in ms for the Retry-After window; tests drive it, production uses Date.now. */
  nowMs?: () => number;
}

const NETWORK_ID = /^[a-z0-9_-]+$/;

const NullableNumber =z.number().nullable().optional();

/** Only the keys we read; the batched call asks for 24h and 7d changes (the 7d one is keyed with its timeframe). */
const CoinsMarketsBody = z.array(
  z.object({
    id: z.string(),
    current_price: NullableNumber,
    price_change_percentage_24h: NullableNumber,
    price_change_percentage_7d_in_currency: NullableNumber,
    market_cap: NullableNumber,
    total_volume: NullableNumber,
    high_24h: NullableNumber,
    low_24h: NullableNumber,
  }),
);

const MarketChartBody = z.object({ prices: z.array(z.tuple([z.number(), z.number()])) });

/** GeckoTerminal-style onchain reply; total_reserve_in_usd is a string with a junk tail of ~200 digits. */
const OnchainTokenBody = z.object({
  data: z.object({ attributes: z.object({ total_reserve_in_usd: z.union([z.string(), z.number()]).nullable().optional() }) }),
});

/** The error shapes observed in notes section 5: status.error_message (also under a top-level error_code) and plain error. */
const ErrorBody = z.union([
  z.object({ status: z.object({ error_message: z.string() }) }).transform((b) => b.status.error_message),
  z.object({ error: z.string() }).transform((b) => b.error),
]);

interface JsonReply {
  status: number;
  body: unknown;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Cloudflare answers a throttled minute with the plain text "Throttled"; the status says enough.
    return undefined;
  }
}

function describeFailure(status: number, text: string): string {
  const detail = ErrorBody.safeParse(parseJsonText(text));
  return detail.success ? `coingecko ${status}: ${detail.data}` : `coingecko ${status}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A 200 that does not match the documented shape is an upstream fault, surfaced like any other. */
function parseBody<T>(schema: z.ZodType<T>, reply: JsonReply): T {
  const result = schema.safeParse(reply.body);
  if (!result.success) throw new PriceSourceError("coingecko: unexpected response shape", reply.status);
  return result.data;
}

export class CoinGeckoPriceSource implements PriceSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  /** After a 429 nothing is sent until this instant, so cached data is all that is served (demo plan is ~30/min). */
  private blockedUntilMs = 0;

  constructor(options: CoinGeckoOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? COINGECKO_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.nowMs = options.nowMs ?? Date.now;
  }

  async markets(ids: string[]): Promise<Record<string, CoinMarket>> {
    const reply = await this.getJson("/coins/markets", {
      vs_currency: VS_CURRENCY,
      ids: ids.join(","),
      per_page: String(MARKETS_PER_PAGE),
      price_change_percentage: "24h,7d",
      precision: PRICE_PRECISION,
      sparkline: "false",
    });
    const out: Record<string, CoinMarket> = {};
    for (const coin of parseBody(CoinsMarketsBody, reply)) {
      // A coin without a price is not a row worth showing; it takes the same path as an id CoinGecko dropped.
      if (coin.current_price === null || coin.current_price === undefined) continue;
      out[coin.id] = {
        usd: coin.current_price,
        change24hPct: coin.price_change_percentage_24h ?? null,
        change7dPct: coin.price_change_percentage_7d_in_currency ?? null,
        marketCapUsd: coin.market_cap ?? null,
        volume24hUsd: coin.total_volume ?? null,
        high24hUsd: coin.high_24h ?? null,
        low24hUsd: coin.low_24h ?? null,
      };
    }
    return out;
  }

  async marketChart(id: string, days: number): Promise<RawChartPoint[]> {
    const reply = await this.getJson(`/coins/${encodeURIComponent(id)}/market_chart`, {
      vs_currency: VS_CURRENCY,
      days: String(days),
      precision: PRICE_PRECISION,
    });
    return parseBody(MarketChartBody, reply).prices.map(([ms, price]): RawChartPoint => [Math.floor(ms / MS_PER_SECOND), price]);
  }

  async onchainLiquidityUsd(network: string, address: string): Promise<string | null> {
    // The network comes from tokens.json and lands in a URL path, so anything outside the id alphabet is refused.
    if (!NETWORK_ID.test(network)) throw new PriceSourceError("coingecko: invalid onchain network id");
    let reply: JsonReply;
    try {
      reply = await this.getJson(`/onchain/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(address)}`, {});
    } catch (err) {
      // 404 means "no pool listed" (BTC, a brand-new token): a fact, not a fault.
      if (err instanceof PriceSourceError && err.status === HTTP_NOT_FOUND) return null;
      throw err;
    }
    const reserve = parseBody(OnchainTokenBody, reply).data.attributes.total_reserve_in_usd;
    return reserve === null || reserve === undefined ? null : truncateUsd(reserve);
  }

  private async getJson(path: string, query: Record<string, string>): Promise<JsonReply> {
    if (this.nowMs() < this.blockedUntilMs) {
      throw new PriceSourceError("coingecko rate limited; serving cache until the Retry-After window ends", HTTP_TOO_MANY);
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    // A plain setTimeout rather than AbortSignal.timeout so the injected fake timers in tests control it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
    let status: number;
    let text: string;
    let retryAfter: string | null;
    try {
      const response = await this.fetchImpl(url.toString(), { headers: this.authHeaders(), signal: controller.signal });
      status = response.status;
      retryAfter = response.headers.get("retry-after");
      text = await response.text();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PriceSourceError(`coingecko request timed out after ${COINGECKO_TIMEOUT_MS} ms`);
      }
      throw new PriceSourceError(`coingecko request failed: ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
    }
    if (status === HTTP_TOO_MANY) this.blockedUntilMs = this.nowMs() + retryAfterSeconds(retryAfter) * MS_PER_SECOND;
    if (status !== HTTP_OK) throw new PriceSourceError(describeFailure(status, text), status);
    return { status, body: parseJsonText(text) };
  }

  /** The header name follows the host: a demo key on the pro host (or the reverse) is rejected upstream. */
  private authHeaders(): Record<string, string> {
    if (this.apiKey.length === 0) return {};
    const header = new URL(this.baseUrl).hostname === PRO_HOST ? PRO_KEY_HEADER : DEMO_KEY_HEADER;
    return { [header]: this.apiKey };
  }
}

/** Seconds form only; an HTTP-date or a missing header falls back to a conservative minute. */
function retryAfterSeconds(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

const USD_PREFIX = /^(\d+)(\.\d{1,2})?/;

/** The reserve string carries ~200 junk digits; cents are all anyone needs, so it is cut, never rounded. */
export function truncateUsd(value: string | number): string | null {
  // A JS number or an exponent-form string would defeat the digit regex, so those go through the safe formatter.
  const text = typeof value === "number" || /e/i.test(value) ? safeDecimal(Number(value)) : value;
  const match = text === null ? null : USD_PREFIX.exec(text);
  return match ? match[0] : null;
}

function safeDecimal(value: number): string | null {
  return Number.isFinite(value) && value >= 0 ? numberToDecimalString(value) : null;
}

export function createPriceSource(config: Config, fetchImpl?: typeof fetch): PriceSource {
  return new CoinGeckoPriceSource({ apiKey: config.coingeckoApiKey, ...(fetchImpl ? { fetchImpl } : {}) });
}
