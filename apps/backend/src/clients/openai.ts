import OpenAI, { APIConnectionTimeoutError, APIError, AuthenticationError } from "openai";
import type { Config } from "../config";
import { INSIGHT_SCHEMA_NAME, InsightModelError, type InsightModel, type InsightModelInput } from "./insightModel";

/** FR-I-01 wants the tab to render within 6 s of a click; the service retries once, so a hung call must give up early. */
export const OPENAI_TIMEOUT_MS = 8_000;
/** The service does exactly one retry itself (FR-B-03); the SDK's default of two would triple the wait. */
const SDK_RETRIES = 0;
const HTTP_UNAUTHORIZED = 401;

export interface OpenAiInsightModelOptions {
  apiKey: string;
  model: string;
  /** Tests point this at a fake; production keeps the SDK default. */
  baseURL?: string;
  /** Injected so unit tests never touch the network (X-04). */
  fetchImpl?: typeof fetch;
}

/** 401 bodies echo part of the key, so the upstream message is never forwarded for that status (RULES 2.1). */
function toModelError(err: unknown): InsightModelError {
  if (err instanceof AuthenticationError) return new InsightModelError(`openai rejected the API key (${HTTP_UNAUTHORIZED})`);
  if (err instanceof APIConnectionTimeoutError) {
    return new InsightModelError(`openai request timed out after ${OPENAI_TIMEOUT_MS} ms`);
  }
  if (err instanceof APIError) return new InsightModelError(`openai ${err.status ?? "connection"} error: ${err.message}`);
  return new InsightModelError(`openai call failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** One Structured Outputs call on the Responses API (docs/notes/openai-structured-outputs.md sections 4 and 7). */
export class OpenAiInsightModel implements InsightModel {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiInsightModelOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? null,
      fetch: options.fetchImpl,
      maxRetries: SDK_RETRIES,
      timeout: OPENAI_TIMEOUT_MS,
    });
  }

  async complete({ prompt, schema, maxOutputTokens }: InsightModelInput): Promise<unknown> {
    let response;
    try {
      response = await this.client.responses.parse({
        model: this.model,
        input: prompt,
        text: { format: { type: "json_schema", name: INSIGHT_SCHEMA_NAME, strict: true, schema } },
        max_output_tokens: maxOutputTokens,
        // GPT-5.6/GPT-6 models reason by default and reasoning tokens count against max_output_tokens;
        // with a 300-token budget the answer would be cut off before any visible output (notes section 7).
        reasoning: { effort: "none" },
        store: false,
      });
    } catch (err) {
      throw toModelError(err);
    }
    if (response.status !== "completed") {
      throw new InsightModelError(`openai response ${response.status ?? "unknown"}: ${response.incomplete_details?.reason ?? "no detail"}`);
    }
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") throw new InsightModelError(`openai refused: ${part.refusal}`);
      }
    }
    if (response.output_parsed === null) throw new InsightModelError("openai returned no JSON output");
    return response.output_parsed;
  }
}

/** Without a key or model id the insight tab still works through the degraded fallback (FR-I-03). */
export class NotConfiguredInsightModel implements InsightModel {
  async complete(): Promise<unknown> {
    throw new InsightModelError("OPENAI_API_KEY or OPENAI_MODEL is not configured");
  }
}

export interface InsightModelDeps {
  fetchImpl?: typeof fetch;
}

export function createInsightModel(config: Config, deps: InsightModelDeps = {}): InsightModel {
  if (config.openaiApiKey.length === 0 || config.openaiModel.length === 0) return new NotConfiguredInsightModel();
  return new OpenAiInsightModel({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}
