import { CHAINS, type Token } from "@predictx/shared";
import { useState } from "react";
import { useApp } from "../../context";
import { COPY, loadError } from "../../copy";
import { diff, percentOver } from "../../decimal";
import { formatPctDetail, formatUsdDelta, isNegative } from "../../marketFormat";
import { useNow } from "../../react/useExternal";
import { useMarket } from "../../react/useMarket";
import { useMarketChart } from "../../react/useMarketChart";
import { scrubLabel } from "../../chart";
import { formatUsdPrice } from "../../view";
import { Button, Notice } from "../primitives";
import { CardHeader } from "./CardHeader";
import { PriceBlock, StatColumns } from "./CardStats";
import { PriceChart, type ScrubPoint } from "./PriceChart";

export interface TokenMarketCardProps {
  token: Token;
  /** Called before onSwap/onDetails so the hover card closes first. */
  onClose?(): void;
  onSwap(): void;
  onDetails(): void;
  onPredict(): void;
  dashboardUrl?: string;
}

const ACTION =
  "h-12 cursor-pointer rounded-full border-0 text-16 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The hover card body: price, 24h change, market stats, chart and the two actions. It loads its own data, so the
 * host only supplies the token and what each button does.
 */
export function TokenMarketCard({ token, onClose, onSwap, onDetails, onPredict, dashboardUrl }: TokenMarketCardProps) {
  const app = useApp();
  const now = useNow();
  const { market, error, delayed, retry } = useMarket(app.api, token.symbol, now);
  const chart = useMarketChart(app.api, token.symbol, "24h");
  const [scrub, setScrub] = useState<ScrubPoint | null>(null);

  const open = chart.chart?.openUsd ?? null;
  const scrubbing = scrub !== null && open !== null;
  const scrubDelta = scrubbing ? diff(scrub.price, open) : null;
  const up = scrubDelta !== null ? !isNegative(scrubDelta) : market ? !isNegative(market.change24hPct) : true;

  let price: string | null = market ? formatUsdPrice(market.priceUsd) : null;
  let change: string | null = market ? formatPctDetail(market.change24hPct) : null;
  if (market && market.change24hUsd !== null) change = `${formatUsdDelta(market.change24hUsd)} (${change})`;
  if (scrubbing && scrubDelta !== null) {
    const pct = percentOver(scrub.price, open);
    price = formatUsdPrice(scrub.price);
    change = `${formatUsdDelta(scrubDelta)}${pct !== null ? ` (${formatPctDetail(pct)})` : ""}`;
  }
  const suffix = scrubbing && chart.chart ? scrubLabel(scrub.t, chart.chart.range) : "24h";

  const onBase = token.address !== null && token.flashChainId === CHAINS.BASE_MAINNET.id;
  const menu = {
    address: token.address,
    explorerUrl: onBase ? `${CHAINS.BASE_MAINNET.explorer}/token/${token.address}` : null,
    dashboardUrl: dashboardUrl ?? app.dashboardUrl,
  };
  const swapDisabled = !token.flashSupported;

  return (
    <div
      className="flex flex-col rounded-card border border-rule bg-ink p-6 text-text"
      style={{ width: "100%", maxWidth: 480, boxSizing: "border-box" }}
    >
      <CardHeader token={token} verified={market?.verified ?? false} onPredict={onPredict} menu={menu} />
      <div className="mt-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <PriceBlock price={price} change={change} up={up} suffix={suffix} />
        <StatColumns market={market} />
      </div>
      {delayed ? <div role="status" className="mt-2 text-12 text-mute">{COPY.price_delayed}</div> : null}
      {error && !market ? (
        <div className="mt-4">
          <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={retry}>Try again</Button>}>{loadError(token.symbol)}</Notice>
        </div>
      ) : null}
      <div className="mt-4">
        <PriceChart view={chart} currentPrice={market?.priceUsd ?? null} up={market ? !isNegative(market.change24hPct) : true} onScrub={setScrub} />
      </div>
      <div className="mt-9 grid grid-cols-2 gap-4">
        <button type="button" className={`${ACTION} bg-ink2 text-text`} onClick={() => { onClose?.(); onDetails(); }}>
          {COPY.view_details}
        </button>
        <button
          type="button"
          className={`${ACTION} bg-text text-ink`}
          disabled={swapDisabled}
          title={swapDisabled ? COPY.swap_unavailable : undefined}
          onClick={() => { onClose?.(); onSwap(); }}
        >
          {COPY.swap}
        </button>
      </div>
      {swapDisabled ? <p data-testid="swap-hint" className="m-0 mt-2 text-center text-12 text-mute">{COPY.swap_unavailable}</p> : null}
    </div>
  );
}
