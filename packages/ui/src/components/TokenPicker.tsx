import { CHAINS, type Token } from "@predictx/shared";
import { useApp } from "../context";
import { COPY, loadError } from "../copy";
import { useNow } from "../react/useExternal";
import { useMarket } from "../react/useMarket";
import { formatChange, formatUsdPrice } from "../view";
import { Badge, Button, Notice, Skeleton, cx } from "./primitives";
import { AddressChip } from "./wallet";

/** Token select with its live price underneath: the header of the AI and Swap screens. */
export function TokenPicker({ tokens, symbol, onChange, only }: { tokens: Token[]; symbol: string; onChange(symbol: string): void; only?: (t: Token) => boolean }) {
  const { api } = useApp();
  const now = useNow();
  const options = only ? tokens.filter(only) : tokens;
  const token = tokens.find((t) => t.symbol === symbol);
  const { market, error, delayed, retry } = useMarket(api, symbol, now);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-rule bg-ink2 p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-13 text-mute">
          Token
          <select
            value={symbol}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 rounded-input border border-rule bg-ink px-2 text-14 font-semibold text-text"
          >
            {options.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </label>
        {token?.flashChainId === CHAINS.BASE_MAINNET.id ? <Badge>{CHAINS.BASE_MAINNET.name}</Badge> : null}
      </div>
      {market ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-28 font-bold">{formatUsdPrice(market.priceUsd)}</span>
            <span className={cx("text-13 font-semibold", market.change24hPct < 0 ? "text-no" : "text-yes")}>{formatChange(market.change24hPct)} today</span>
          </div>
          {delayed ? <span className="text-12 text-mute">{COPY.price_delayed}</span> : null}
        </div>
      ) : error ? (
        <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={retry}>Try again</Button>}>{loadError(symbol)}</Notice>
      ) : (
        <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-7 w-32" /></div>
      )}
      {token?.address ? <AddressChip address={token.address} explorer={CHAINS.BASE_MAINNET.explorer} /> : null}
    </div>
  );
}
