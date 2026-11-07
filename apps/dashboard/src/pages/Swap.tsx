import { Notice, Skeleton, SwapPanel, TokenPicker, useTokens } from "@predictx/ui";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { api } from "../services";

/** Real Flash quotes for the tokens it can trade. Review only: this build never sends an order. */
export function Swap() {
  const tokens = useTokens(api);
  const swappable = tokens.filter((t) => t.flashSupported);
  const [params] = useSearchParams();
  const location = useLocation();
  const [picked, setPicked] = useState<string | null>(null);
  // A suggested price arrives as ?symbol=ETH&limit=2100; once the user picks another token the hint no longer applies.
  const fromLink = params.get("symbol");
  const token = swappable.find((t) => t.symbol === (picked ?? fromLink)) ?? swappable[0];
  const limit = picked === null || picked === fromLink ? params.get("limit") : null;
  return (
    <PageShell title="Swap" lead="See what a buy would cost on Base through Flash. Quotes are real; orders are switched off." width={560}>
      {token ? (
        <section aria-label="Swap quote" className="flex flex-col gap-3 rounded-card border border-rule bg-ink p-5 shadow-card">
          <TokenPicker tokens={tokens} symbol={token.symbol} onChange={setPicked} only={(t) => t.flashSupported} />
          <SwapPanel key={`${token.symbol}:${location.key}`} token={token} initialLimit={limit && token.symbol === fromLink ? limit : null} />
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
