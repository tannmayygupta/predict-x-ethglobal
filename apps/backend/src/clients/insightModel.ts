/** Adapter boundary for the OpenAI Structured Outputs call. The real client lives in openai.ts (T-B05). */

/** text.format.name on the Responses API: a-z, A-Z, 0-9, _ or -, at most 64 chars. */
export const INSIGHT_SCHEMA_NAME = "insight";

export interface InsightModelInput {
  prompt: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface InsightModel {
  /** Resolves with the parsed JSON object the model produced, or throws InsightModelError. */
  complete(input: InsightModelInput): Promise<unknown>;
}

export class InsightModelError extends Error {
  /**
   * False for failures a second call cannot fix (bad key, refusal) or cannot afford (a timeout already used
   * most of the 6 s budget), so the service skips its one retry.
   */
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "InsightModelError";
    this.retryable = options.retryable ?? true;
  }
}
