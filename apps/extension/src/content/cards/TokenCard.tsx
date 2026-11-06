import { CHAINS, type Token } from "@predictx/shared";
import {
  AddressChip, Badge, Button, COPY, Notice, Skeleton, Tabs, formatChange, formatUsdPrice, loadError, useNow, cx,
} from "@predictx/ui";
import { useState } from "react";
import type { AnchorRect, HoverStore } from "../../x/hoverStore";
import { placeCard } from "../../x/hoverStore";
import { InsightTab } from "./InsightTab";
import { SwapTab } from "./SwapTab";
import { useMarket } from "./useMarket";

const CARD_WIDTH = 340;
const CARD_HEIGHT = 360;
type Tab = "swap" | "insight";

/** A1: the hover card. Header is live market data; Swap exists only for tokens Flash can trade. */
export function TokenCard({ token, anchor, store, onPredict }: { token: Token; anchor: AnchorRect; store: HoverStore; onPredict(symbol: string): void }) {
  const now = useNow();
  const { market, error, delayed, retry } = useMarket(token.symbol, now);
  const [tab, setTab] = useState<Tab>(token.flashSupported ? "swap" : "insight");
  const [suggestedLimit, setSuggestedLimit] = useState<string | null>(null);
  const place = placeCard(anchor, { width: window.innerWidth, height: window.innerHeight }, { width: CARD_WIDTH, height: CARD_HEIGHT });
  const tabs: ReadonlyArray<{ value: Tab; label: string }> = token.flashSupported
    ? [{ value: "swap", label: "Swap" }, { value: "insight", label: "Insight" }]
    : [{ value: "insight", label: "Insight" }];

  return (
    <section
      role="dialog"
      aria-label={`${token.name} ${token.symbol}`}
      onMouseEnter={store.enterCard}
      onMouseLeave={store.leaveCard}
      style={{ left: place.left, top: place.top, width: CARD_WIDTH }}
      className="px-card-in pointer-events-auto fixed overflow-hidden rounded-card border border-rule bg-ink text-text shadow-card"
    >
      <header className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 font-display text-16 font-semibold">
            {token.name} <span className="text-mute">{token.symbol}</span>
          </h2>
          <span className="flex items-center gap-2">
            {token.flashChainId === CHAINS.BASE_MAINNET.id ? <Badge>{CHAINS.BASE_MAINNET.name}</Badge> : null}
            <Button variant="ghost" size="sm" aria-label="Close token card" onClick={store.close}>x</Button>
          </span>
        </div>
        {market ? (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-28 font-bold">{formatUsdPrice(market.priceUsd)}</span>
              <span className={cx("text-13", market.change24hPct < 0 ? "text-no" : "text-yes")}>{formatChange(market.change24hPct)} today</span>
            </div>
            {delayed ? <span className="text-12 text-mute">{COPY.price_delayed}</span> : null}
          </>
        ) : error ? (
          <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={retry}>Try again</Button>}>
            {loadError(token.symbol)}
          </Notice>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-40" />
          </div>
        )}
        {token.address ? <AddressChip address={token.address} explorer={CHAINS.BASE_MAINNET.explorer} /> : null}
      </header>

      <Tabs<Tab> tabs={tabs} value={tab} onChange={(next) => setTab(next)} />
      {tab === "swap" && token.flashSupported ? (
        <SwapTab token={token} initialLimit={suggestedLimit} />
      ) : (
        <InsightTab
          symbol={token.symbol}
          canTrade={token.flashSupported}
          onUseLimit={(price) => { setSuggestedLimit(price); setTab("swap"); }}
        />
      )}
      <footer className="flex items-center justify-between border-t border-rule px-4 py-2 text-12 text-mute">
        <Button variant="secondary" size="sm" onClick={() => onPredict(token.symbol)}>{COPY.create_cta}</Button>
        {token.flashSupported ? <span>Trades run on Base</span> : null}
      </footer>
    </section>
  );
}
