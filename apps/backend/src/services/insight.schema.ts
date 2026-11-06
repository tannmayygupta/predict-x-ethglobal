import { InsightResponse } from "@predictx/shared";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { INSIGHT_SCHEMA_NAME } from "../clients/insightModel";

/**
 * What the model fills in. The service owns symbol, degraded and disclaimer, so they are left out of
 * the model-facing schema (B05-04); everything else is the shared InsightResponse verbatim, so a
 * contract change there changes the prompt schema with it (RULES 4.1).
 */
export const InsightDraft = InsightResponse.omit({ symbol: true, degraded: true, disclaimer: true });
export type InsightDraft = z.infer<typeof InsightDraft>;

/**
 * Strict JSON Schema (every property required, additionalProperties false, null via anyOf) produced
 * by the SDK's own converter, so it is exactly what the SDK would send for a zod format.
 */
export const insightJsonSchema: Record<string, unknown> = zodTextFormat(InsightDraft, INSIGHT_SCHEMA_NAME).schema;
