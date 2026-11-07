import { TokenMarketCard, useTokens } from "@predictx/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services";

/**
 * The extension's hover card rendered against the live backend, on the dark lime theme, so it can be checked
 * without loading the extension. The buttons go to the dashboard pages that mirror the panel tabs.
 */
export function CardPreview() {
  const tokens = useTokens(api);
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);
  const token = tokens.find((t) => t.symbol === picked) ?? tokens[0];

  return (
    <section aria-label="Token card" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 font-display text-20 font-bold">Token card</h2>
        <label className="flex items-center gap-2 text-13 text-mute">
          Token
          <select
            value={token?.symbol ?? ""}
            onChange={(e) => setPicked(e.target.value)}
            className="h-8 rounded-input border border-rule bg-ink px-2 text-14 font-semibold text-text"
          >
            {tokens.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </label>
      </div>
      <div className="px-theme-dark flex justify-center rounded-card p-6" style={{ background: "var(--px-page)" }}>
        {token ? (
          <TokenMarketCard
            key={token.symbol}
            token={token}
            onSwap={() => navigate(`/swap?symbol=${token.symbol}`)}
            onDetails={() => navigate("/ai")}
            onPredict={() => navigate("/predict")}
          />
        ) : (
          <p className="m-0 text-14 text-mute" aria-busy="true">Connecting to the PredictX server...</p>
        )}
      </div>
    </section>
  );
}
