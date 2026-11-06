import { MAX_INTENT_LENGTH, type InsightResponse } from "@predictx/shared";
import { Badge, Button, COPY, Notice, Skeleton, TextField, formatUsdPrice, loadError, type ApiClientError } from "@predictx/ui";
import { useState } from "react";
import { api } from "../api";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiClientError }
  | { kind: "ready"; insight: InsightResponse };

const BIAS_TONE = { bullish: "yes", bearish: "no", neutral: "neutral" } as const;
const BIAS_LABEL = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" } as const;
const CONFIDENCE_LABEL = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" } as const;

/** The AI tip. It only reads: nothing here can sign, send or place an order (FR-I-04). */
export function InsightTab({ symbol, canTrade, onUseLimit }: { symbol: string; canTrade: boolean; onUseLimit(priceUsd: string): void }) {
  const [intent, setIntent] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = (): void => {
    setState({ kind: "loading" });
    const userIntent = intent.trim();
    api
      .insight({ symbol, ...(userIntent ? { userIntent } : {}) })
      .then((insight) => setState({ kind: "ready", insight }))
      .catch((error: ApiClientError) => setState({ kind: "error", error }));
  };

  return (
    <div className="flex flex-col gap-3 p-4">
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
        <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={run}>Try again</Button>}>
          {loadError("the insight")}
        </Notice>
      ) : null}

      {state.kind === "ready" ? <InsightResult insight={state.insight} canTrade={canTrade} onUseLimit={onUseLimit} /> : null}
    </div>
  );
}

function InsightResult({ insight, canTrade, onUseLimit }: { insight: InsightResponse; canTrade: boolean; onUseLimit(priceUsd: string): void }) {
  const limit = insight.suggestedLimit;
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      {insight.degraded ? <Notice kind="info">{COPY.insight_degraded}</Notice> : null}
      <div className="flex gap-2">
        <Badge tone={BIAS_TONE[insight.bias]}>{BIAS_LABEL[insight.bias]}</Badge>
        <Badge>{CONFIDENCE_LABEL[insight.confidence]}</Badge>
      </div>
      <p className="m-0 text-14 text-text">{insight.tip}</p>
      {limit ? (
        <>
          <p className="m-0 text-13 text-mute">
            Suggested limit: <span className="font-display font-semibold text-text">{formatUsdPrice(limit.priceUsd)}</span> ({limit.reason})
          </p>
          {canTrade ? (
            <Button variant="secondary" onClick={() => onUseLimit(limit.priceUsd)}>
              {COPY.use_limit}
            </Button>
          ) : null}
        </>
      ) : null}
      <span className="text-12 text-mute">{insight.disclaimer || COPY.disclaimer}</span>
    </div>
  );
}
