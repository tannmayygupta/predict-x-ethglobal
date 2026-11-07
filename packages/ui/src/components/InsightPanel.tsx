import { MAX_INTENT_LENGTH, type InsightResponse } from "@predictx/shared";
import { useState } from "react";
import type { ApiClientError } from "../api";
import { useApp } from "../context";
import { COPY, loadError, suggestedLimitRow } from "../copy";
import { percentOver } from "../decimal";
import { formatUsdPrice } from "../view";
import { readInsight, writeInsight } from "./insightCache";
import { TextField } from "./forms";
import { Badge, Button, Notice, Skeleton } from "./primitives";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiClientError }
  | { kind: "ready"; insight: InsightResponse };

const BIAS_TONE = { bullish: "yes", bearish: "no", neutral: "neutral" } as const;
const BIAS_LABEL = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" } as const;
const CONFIDENCE_LABEL = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" } as const;

/** What the Swap tab needs to apply the suggestion. */
export interface LimitSuggestion {
  symbol: string;
  priceUsd: string;
  /** Spot price the tip was written against, or null for an old cached row. */
  spotUsd: string | null;
}

export interface InsightPanelProps {
  symbol: string;
  canTrade: boolean;
  /**
   * The second argument carries the full suggestion; callers written for the old one-argument shape keep working
   * because a function that ignores its extra parameter is still assignable.
   */
  onUseLimit(priceUsd: string, suggestion: LimitSuggestion): void;
}

/** Message for each failure the insight endpoint can return; anything else gets the generic retry line. */
export function insightErrorText(error: ApiClientError): string {
  switch (error.code) {
    case "RATE_LIMITED": return COPY.insight_rate_limited;
    case "UNSUPPORTED_TOKEN": return COPY.insight_unsupported;
    case "LLM_UNAVAILABLE": return COPY.insight_llm_unavailable;
    case "NETWORK": return COPY.insight_network;
    default: return loadError("the insight");
  }
}

function clock(unix: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(unix * 1000));
}

/** The AI tip. It only reads: nothing here can sign, send or place an order (FR-I-04). */
export function InsightPanel({ symbol, canTrade, onUseLimit }: InsightPanelProps) {
  const { api } = useApp();
  const cached = readInsight(symbol);
  const [intent, setIntent] = useState(cached?.intent ?? "");
  const [state, setState] = useState<State>(cached ? { kind: "ready", insight: cached.insight } : { kind: "idle" });

  const run = (): void => {
    setState({ kind: "loading" });
    const userIntent = intent.trim();
    api
      .insight({ symbol, ...(userIntent ? { userIntent } : {}) })
      .then((insight) => {
        // A fallback note must not outlive the retry that would replace it.
        if (!insight.degraded) writeInsight(symbol, insight, intent);
        setState({ kind: "ready", insight });
      })
      .catch((error: ApiClientError) => setState({ kind: "error", error }));
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="What are you planning? (optional)"
        value={intent}
        onChange={setIntent}
        maxLength={MAX_INTENT_LENGTH}
        placeholder="I want to buy on a dip"
        suffix={`${intent.length}/${MAX_INTENT_LENGTH}`}
        disabled={state.kind === "loading"}
      />
      <Button loading={state.kind === "loading"} onClick={run}>
        {COPY.insight_cta}
      </Button>

      {state.kind === "loading" ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <span className="text-13 text-mute">{COPY.insight_loading}</span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : null}

      {state.kind === "error" ? (
        <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={run}>{COPY.insight_retry}</Button>}>
          {insightErrorText(state.error)}
        </Notice>
      ) : null}

      {state.kind === "ready" ? <InsightResult insight={state.insight} canTrade={canTrade} onUseLimit={onUseLimit} onRetry={run} /> : null}
    </div>
  );
}

function InsightResult({ insight, canTrade, onUseLimit, onRetry }: { insight: InsightResponse; canTrade: boolean; onUseLimit: InsightPanelProps["onUseLimit"]; onRetry(): void }) {
  const limit = insight.suggestedLimit;
  const gap = limit && insight.spotUsd ? percentOver(limit.priceUsd, insight.spotUsd, 1) : null;
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      {insight.degraded ? (
        <Notice kind="info" action={<Button size="sm" variant="secondary" onClick={onRetry}>{COPY.insight_retry}</Button>}>
          {COPY.insight_degraded}
        </Notice>
      ) : null}
      <div className="flex gap-2">
        <Badge tone={BIAS_TONE[insight.bias]}>{BIAS_LABEL[insight.bias]}</Badge>
        <Badge>{CONFIDENCE_LABEL[insight.confidence]}</Badge>
      </div>
      <p className="m-0 text-14 text-text">{insight.tip}</p>
      {limit ? (
        <>
          <p className="m-0 text-13 text-mute">
            {insight.spotUsd && gap !== null
              ? suggestedLimitRow(formatUsdPrice(limit.priceUsd), `${gap}%`, formatUsdPrice(insight.spotUsd), insight.asOf !== null ? clock(insight.asOf) : null)
              : `Suggested limit ${formatUsdPrice(limit.priceUsd)}`}
          </p>
          <p className="m-0 text-12 text-mute">{limit.reason}</p>
          {canTrade ? (
            <Button variant="secondary" onClick={() => onUseLimit(limit.priceUsd, { symbol: insight.symbol, priceUsd: limit.priceUsd, spotUsd: insight.spotUsd })}>
              {COPY.use_limit}
            </Button>
          ) : null}
        </>
      ) : (
        <p className="m-0 text-13 text-mute">{COPY.insight_empty}</p>
      )}
      <span className="text-12 text-mute">{insight.disclaimer || COPY.disclaimer}</span>
    </div>
  );
}
