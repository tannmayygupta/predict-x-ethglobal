import { Notice, Skeleton, SwapPanel, TokenPicker, useTokens } from "@predictx/ui";
import { useState } from "react";
import { PageShell } from "../components/PageShell";
import { api } from "../services";

/** Real Flash quotes for the tokens it can trade. Review only: this build never sends an order. */
export function Swap() {
  const tokens = useTokens(api);
  const swappable = tokens.filter((t) => t.flashSupported);
  const [picked, setPicked] = useState<string | null>(null);
  const token = swappable.find((t) => t.symbol === picked) ?? swappable[0];
  return (
    <PageShell title="Swap" lead="See what a buy would cost on Base through Flash. Quotes are real; orders are switched off." width={560}>
      {token ? (
        <section aria-label="Swap quote" className="flex flex-col gap-3 rounded-card border border-rule bg-ink p-5 shadow-card">
          <TokenPicker tokens={tokens} symbol={token.symbol} onChange={setPicked} only={(t) => t.flashSupported} />
          <SwapPanel key={token.symbol} token={token} initialLimit={null} />
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
