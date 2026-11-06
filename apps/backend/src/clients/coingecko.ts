import { z } from "zod";
import type { Config } from "../config";
import { PriceSourceError, type PriceSource, type SimplePriceEntry } from "./priceSource";

/** Demo and keyless plans share this root; the paid plan lives on pro-api (docs/notes/coingecko-api.md section 1). */
export const COINGECKO_DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";
const PRO_HOST = "pro-api.coingecko.com";
const DEMO_KEY_HEADER = "x-cg-demo-api-key";
const PRO_KEY_HEADER = "x-cg-pro-api-key";
const VS_CURRENCY = "usd";
const SEVEN_DAYS = "7d";
/** Without this CoinGecko rounds PEPE-scale prices (5.0079e-06 becomes 5.0e-06), useless against a strike. */
const PRICE_PRECISION = "full";
const HTTP_OK = 200;
/** TEST_PLAN B02-17: a hover card waiting longer than this should show the stale price instead. */
export const COINGECKO_TIMEOUT_MS = 3000;

export interface CoinGeckoOptions {
  /** Empty means keyless: no auth header at all (an invalid key is rejected, it does not fall back). */
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const SimplePriceBody = z.record(
  z.string(),
  z.object({ usd: z.number(), usd_24h_change: z.number().nullable().optional() }),
);

/** Each requested timeframe X adds price_change_percentage_X_in_currency; the array is not keyed by id. */
const CoinsMarketsBody = z.array(
  z.object({ id: z.string(), price_change_percentage_7d_in_currency: z.number().nullable().optional() }),
);

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

  constructor(options: CoinGeckoOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? COINGECKO_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async simplePrice(ids: string[]): Promise<Record<string, SimplePriceEntry>> {
    const reply = await this.getJson("/simple/price", {
      ids: ids.join(","),
      vs_currencies: VS_CURRENCY,
      include_24hr_change: "true",
      precision: PRICE_PRECISION,
    });
    const out: Record<string, SimplePriceEntry> = {};
    for (const [id, entry] of Object.entries(parseBody(SimplePriceBody, reply))) {
      out[id] = { usd: entry.usd, usd24hChange: entry.usd_24h_change ?? null };
    }
    return out;
  }

  /**
   * D-B7: simple/price has no 7d field, so this is a second, lazy call (only the insight prompt needs it).
   * coins/markets costs one credit for any number of ids; coins/{id} would be ~32 KB per coin.
   */
  async change7dPct(id: string): Promise<number | null> {
    const reply = await this.getJson("/coins/markets", {
      vs_currency: VS_CURRENCY,
      ids: id,
      price_change_percentage: SEVEN_DAYS,
    });
    const item = parseBody(CoinsMarketsBody, reply).find((coin) => coin.id === id);
    return item?.price_change_percentage_7d_in_currency ?? null;
  }

  private async getJson(path: string, query: Record<string, string>): Promise<JsonReply> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    // A plain setTimeout rather than AbortSignal.timeout so the injected fake timers in tests control it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const response = await this.fetchImpl(url.toString(), { headers: this.authHeaders(), signal: controller.signal });
      status = response.status;
      text = await response.text();
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PriceSourceError(`coingecko request timed out after ${COINGECKO_TIMEOUT_MS} ms`);
      }
      throw new PriceSourceError(`coingecko request failed: ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
    }
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

export function createPriceSource(config: Config, fetchImpl?: typeof fetch): PriceSource {
  return new CoinGeckoPriceSource({ apiKey: config.coingeckoApiKey, ...(fetchImpl ? { fetchImpl } : {}) });
}
