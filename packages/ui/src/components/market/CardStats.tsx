import type { Market } from "@predictx/shared";
import { COPY } from "../../copy";
import { formatUsdCompact } from "../../marketFormat";
import { Skeleton, cx } from "../primitives";

/** Prices longer than this many characters drop to the smaller size so they fit beside the stats. */
const LONG_PRICE_CHARS = 10;

export interface PriceBlockProps {
  /** Price text, already formatted; null while the first read is in flight. */
  price: string | null;
  /** "+$10.48 (+0.47%)" or null. */
  change: string | null;
  up: boolean;
  /** "24h", or the time under the cursor while scrubbing. */
  suffix: string;
}

/** Price (28px, 20px when long) over the change line (14px, never wraps, then a muted period label). */
export function PriceBlock({ price, change, up, suffix }: PriceBlockProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {price === null ? (
        <Skeleton className="h-7 w-32" />
      ) : (
        <span data-testid="card-price" className={cx("px-tnum whitespace-nowrap font-semibold text-text", price.length > LONG_PRICE_CHARS ? "text-20" : "text-28")}>{price}</span>
      )}
      <span className="px-tnum whitespace-nowrap text-14 font-medium">
        {change !== null ? <span data-testid="card-change" className={cx(up ? "text-up" : "text-down")}>{change}</span> : null}
        {change !== null ? " " : null}
        <span className="text-mute">{suffix}</span>
      </span>
    </div>
  );
}

/** Market cap, liquidity and 24h volume: compact right-aligned columns, a missing value is an em dash. */
export function StatColumns({ market }: { market: Market | null }) {
  const columns: Array<[string, string | null | undefined]> = [
    [COPY.market_cap, market?.marketCapUsd],
    [COPY.liquidity, market?.liquidityUsd],
    [COPY.volume_24h, market?.volume24hUsd],
  ];
  return (
    <dl className="m-0 ml-auto flex shrink-0 gap-6">
      {columns.map(([label, value]) => (
        <div key={label} className="flex flex-col items-end gap-1">
          <dt className="whitespace-nowrap text-14 text-mute">{label}</dt>
          <dd className="px-tnum m-0 whitespace-nowrap text-14 text-text">{formatUsdCompact(value ?? null)}</dd>
        </div>
      ))}
    </dl>
  );
}
