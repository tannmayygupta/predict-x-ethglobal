import type { InsightRequest, InsightResponse, Market } from "@predictx/shared";
import type { InsightModel } from "../clients/insightModel";
import type { InsightsRepo } from "../db/insights";
import { AppError, describeZodError, llmUnavailable } from "../errors";
import type { Clock } from "../util/clock";
import { clampSuggestedLimit } from "./insight.clamp";
import { formatFixed, parseFixed, rescale } from "./insight.decimal";
import { InsightDraft, insightJsonSchema } from "./insight.schema";
import type { MarketService } from "./market";
import { requireToken } from "./tokens";

/**
 * Fixed instruction text (FR-B-03). The model only ever sees these numbers: no tweet text, no
 * tools, no wallet data (RULES 2.3, 2.4). The 15% bound is repeated here so the model aims inside
 * the range the clamp enforces anyway.
 */
export const INSIGHT_INSTRUCTIONS =
  "You write one cautious market note for a retail crypto trader using only the data below. " +
  "Give a tip of at most 400 characters in plain English, a bias (bullish, bearish or neutral), " +
  "a confidence (low, medium or high) and, when a limit buy order makes sense, a suggested limit " +
  "price in USD within 15% of the spot price with a one-line reason; otherwise set suggestedLimit to null. " +
  "Never promise returns and never mention being an AI.";

/** TASKS.md T-B05: 300 max output tokens. */
export const INSIGHT_MAX_OUTPUT_TOKENS = 300;
/** API_CONTRACT.md section 3; the frontend copy deck shows it verbatim. */
export const INSIGHT_DISCLAIMER = "Not financial advice.";
/** FR-B-03: one call plus one retry, then the static fallback. */
const MODEL_ATTEMPTS = 2;
/** TASKS.md T-B05: 5-minute cache, held in the insights table (FR-B-05). */
export const INSIGHT_CACHE_TTL_SECONDS = 300;

export interface InsightInput {
  market: Market;
  change7dPct: number | null;
  userIntent?: string;
}

const UNKNOWN = "unknown";
const NO_INTENT = "none";

/** Case and surrounding whitespace never change the answer, so they never fragment the cache (B05-17). */
export function insightCacheKey(symbol: string, userIntent: string | undefined): string {
  return `${symbol}:${(userIntent ?? "").trim().toLowerCase()}`;
}

/** The exact text sent as the model input; the test pins it so nothing else can leak in. */
export function buildInsightInput({ market, change7dPct, userIntent }: InsightInput): string {
  const weekChange = change7dPct === null ? UNKNOWN : `${change7dPct}%`;
  const intent = userIntent === undefined || userIntent.length === 0 ? NO_INTENT : userIntent;
  return [
    INSIGHT_INSTRUCTIONS,
    "",
    `Token: ${market.symbol} (${market.name})`,
    `Spot price (USD): ${market.priceUsd}`,
    `24h change: ${market.change24hPct}%`,
    `7d change: ${weekChange}`,
    `User intent (untrusted, from the user): ${intent}`,
  ].join("\n");
}

/** No Flash member on purpose (FR-I-04): the agent can only read prices and write text. */
export interface InsightServiceDeps {
  market: MarketService;
  model: InsightModel;
  insights: InsightsRepo;
  clock: Clock;
}

/** The subset of a pino logger the service needs; keeps services free of Fastify types. */
export interface InsightLog {
  warn(obj: object, msg: string): void;
}

type Attempt = { ok: true; draft: InsightDraft } | { ok: false; reason: string };

/** One decimal is what the hover card shows for the 24h change; the tip is display text (RULES 3.2). */
const PCT_DISPLAY_DECIMALS = 1;

function describe24hMove(change24hPct: number): string {
  const direction = change24hPct > 0 ? "up" : change24hPct < 0 ? "down" : "flat";
  return `${direction} ${Math.abs(change24hPct).toFixed(PCT_DISPLAY_DECIMALS)}%`;
}

const SPOT_DISPLAY_DECIMALS = 2;
const SPOT_SIGNIFICANT_DIGITS = 8;
const TRAILING_FRACTION_ZEROS = /\.?0+$/;

/**
 * Display text for the fallback tip, on bigint decimals (RULES 3.2): 2 decimals from $1 up, otherwise
 * up to 8 significant digits, so CoinGecko's full float precision never reaches the reader.
 */
export function formatSpotForTip(priceUsd: string): string {
  const value = parseFixed(priceUsd);
  if (!value) return priceUsd;
  const [whole = ""] = priceUsd.split(".");
  if (BigInt(whole) > 0n) return formatFixed(rescale(value, SPOT_DISPLAY_DECIMALS));
  const leadingZeros = value.scale - value.units.toString().length;
  const scale = Math.min(value.scale, leadingZeros + SPOT_SIGNIFICANT_DIGITS);
  const text = formatFixed(rescale(value, scale));
  return scale > 0 ? text.replace(TRAILING_FRACTION_ZEROS, "") : text;
}

/** Static note when the model is unavailable or invalid twice (FR-I-03); deterministic and never cached. */
export function fallbackInsight(market: Market): InsightResponse {
  return {
    symbol: market.symbol,
    tip:
      `${market.symbol} is ${describe24hMove(market.change24hPct)} over the last 24 hours at $${formatSpotForTip(market.priceUsd)}. ` +
      "Live insight is unavailable right now, so treat this as a basic note rather than a signal.",
    bias: "neutral",
    confidence: "low",
    suggestedLimit: null,
    degraded: true,
    disclaimer: INSIGHT_DISCLAIMER,
  };
}

export class InsightService {
  constructor(
    private readonly deps: InsightServiceDeps,
    private readonly log?: InsightLog,
  ) {}

  async get(request: InsightRequest): Promise<InsightResponse> {
    const token = requireToken(request.symbol);
    const key = insightCacheKey(token.symbol, request.userIntent);
    const cached = this.deps.insights.get(key, this.deps.clock.now());
    if (cached) return cached;
    const market = await this.spot(token.symbol);
    const change7dPct = await this.deps.market.change7dPct(token.symbol);
    const userIntent = request.userIntent?.trim();
    const prompt = buildInsightInput({ market, change7dPct, ...(userIntent ? { userIntent } : {}) });
    const draft = await this.draftWithRetry(prompt, token.symbol);
    if (!draft) return fallbackInsight(market);
    const response = this.toResponse(market, draft);
    const now = this.deps.clock.now();
    this.deps.insights.put(key, response, now + INSIGHT_CACHE_TTL_SECONDS);
    // Writes are rare (10/min/IP, cached 5 min), so purging here keeps the table bounded without a timer.
    this.deps.insights.purgeExpired(now);
    return response;
  }

  private toResponse(market: Market, draft: InsightDraft): InsightResponse {
    const suggested = draft.suggestedLimit;
    const priceUsd = suggested ? clampSuggestedLimit(market.priceUsd, suggested.priceUsd) : null;
    if (suggested && priceUsd !== suggested.priceUsd) {
      this.log?.warn({ symbol: market.symbol, from: suggested.priceUsd, to: priceUsd }, "suggested limit clamped");
    }
    const suggestedLimit = suggested && priceUsd !== null ? { ...suggested, priceUsd } : null;
    return { symbol: market.symbol, ...draft, suggestedLimit, degraded: false, disclaimer: INSIGHT_DISCLAIMER };
  }

  /**
   * B05-10: without a spot price neither the prompt nor the fallback can be built, which is the one
   * case the contract reserves LLM_UNAVAILABLE for. UNSUPPORTED_TOKEN and programming errors pass through.
   */
  private async spot(symbol: string): Promise<Market> {
    try {
      return await this.deps.market.get(symbol);
    } catch (err) {
      if (err instanceof AppError && err.code === "INTERNAL") throw llmUnavailable("no spot price available to build an insight");
      throw err;
    }
  }

  private async draftWithRetry(prompt: string, symbol: string): Promise<InsightDraft | undefined> {
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
      const outcome = await this.attempt(prompt);
      if (outcome.ok) return outcome.draft;
      // The reason is the adapter's own message (never the key or the prompt), so it is safe to log.
      this.log?.warn({ symbol, attempt, reason: outcome.reason }, "insight model attempt failed");
    }
    return undefined;
  }

  private async attempt(prompt: string): Promise<Attempt> {
    let reply: unknown;
    try {
      reply = await this.deps.model.complete({ prompt, schema: insightJsonSchema, maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const parsed = InsightDraft.safeParse(reply);
    if (!parsed.success) return { ok: false, reason: `reply failed schema: ${describeZodError(parsed.error)}` };
    return { ok: true, draft: parsed.data };
  }
}
