import type { Pool } from "@predictx/shared";
import { formatUsdc } from "@predictx/shared";
import { useNow } from "../react/useExternal";
import { STATUS_LABEL, effectiveStatus, formatCountdown, oddsOf } from "../view";
import { Badge } from "./primitives";

/** Yes on the left, No on the right, 10 px tall. 0/0 shows an empty rule-coloured bar and "No bets yet". */
export function OddsBar({ yesTotal, noTotal }: { yesTotal: string; noTotal: string }) {
  const odds = oddsOf(yesTotal, noTotal);
  if (!odds.hasBets) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-[10px] rounded-bar bg-rule" aria-hidden />
        <span className="text-13 text-mute">No bets yet</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between font-display text-14 font-semibold">
        <span className="text-yes">YES {odds.yesPct}%</span>
        <span className="text-no">NO {odds.noPct}%</span>
      </div>
      <div className="flex h-[10px] overflow-hidden rounded-bar bg-rule" role="img" aria-label={`YES ${odds.yesPct} percent, NO ${odds.noPct} percent`}>
        <div className="bg-yes" style={{ width: `${odds.yesBar}%` }} />
        <div className="bg-no" style={{ width: `${odds.noBar}%` }} />
      </div>
      <div className="flex justify-between text-13 text-mute">
        <span>{formatUsdc(yesTotal)} USDC</span>
        <span>{formatUsdc(noTotal)} USDC</span>
      </div>
    </div>
  );
}

/** MM:SS under an hour, "Hh Mm" above, "Closed" at zero; ticks every second. */
export function Countdown({ resolveTime }: { resolveTime: number }) {
  const now = useNow();
  return <span className="font-display tabular-nums">{formatCountdown(resolveTime, now)}</span>;
}

/** Status badge colours (UI_REFERENCE D2): open amber, awaiting mute, resolved by outcome, void mute. */
export function StatusBadge({ pool }: { pool: Pick<Pool, "status" | "resolveTime" | "outcome"> }) {
  const now = useNow();
  const status = effectiveStatus(pool, now);
  const tone = status === "open" ? "amber" : status === "resolved" ? (pool.outcome === "yes" ? "yes" : "no") : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

