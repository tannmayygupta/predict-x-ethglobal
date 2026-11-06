import { InsightPanel, Notice, Skeleton, TokenPicker, useTokens } from "@predictx/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { api } from "../services";

/** The AI tip for a token. It reads the market and answers in text; it cannot trade. */
export function Insight() {
  const tokens = useTokens(api);
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);
  const token = tokens.find((t) => t.symbol === picked) ?? tokens[0];
  return (
    <PageShell title="AI insight" lead="A short, plain read on where a token stands. Not financial advice." width={560}>
      {token ? (
        <section aria-label="AI insight" className="flex flex-col gap-3 rounded-card border border-rule bg-ink p-5 shadow-card">
          <TokenPicker tokens={tokens} symbol={token.symbol} onChange={setPicked} />
          <InsightPanel key={token.symbol} symbol={token.symbol} canTrade={token.flashSupported} onUseLimit={() => navigate("/swap")} />
        </section>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-[240px]" />
          <Notice kind="info">Connecting to the PredictX server...</Notice>
        </div>
      )}
    </PageShell>
  );
}
