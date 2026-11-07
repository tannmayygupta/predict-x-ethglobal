import { CHAINS, type FlashQuoteResponse, type Token } from "@predictx/shared";
import type { ReactNode } from "react";
import { COPY, quoteValidFor, rateLabel } from "../../copy";
import { compare, isDecimal } from "../../decimal";
import { formatImpact, formatUsdPrice, isMockQuote } from "../../view";
import { Badge, Button, Notice } from "../primitives";
import { AddressChip } from "../wallet";
import { effectiveGap, minReceiveOf, networkCost, orderExpiry, secondsLeft, slippagePercent } from "./swapMath";

const FALLBACK_DECIMALS = 18;
const SECONDS_PER_MINUTE = 60;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-13">
      <span className="text-mute" title={hint}>{label}</span>
      <span className="px-tnum text-right text-14 text-text">{children}</span>
    </div>
  );
}

function expiryText(quote: FlashQuoteResponse, chosenExpireAt: number | null, now: number): string {
  const expiry = orderExpiry(quote, chosenExpireAt);
  if (expiry.kind === "open_ended") return COPY.good_till_cancelled;
  if (expiry.unix <= now) return COPY.order_expired;
  if (quote.orderType === "market") return `about ${Math.max(1, Math.round((expiry.unix - now) / SECONDS_PER_MINUTE))} min`;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(expiry.unix * 1000));
}

export interface QuoteSummaryProps {
  quote: FlashQuoteResponse;
  token: Token;
  now: number;
  /** Unix seconds the user chose for a limit order, or null for good-till-cancelled. */
  chosenExpireAt: number | null;
  /** Live market price, used when the quote carries none (limit quotes). */
  livePrice: string | null;
  onRefresh(): void;
}

/** What an order would be, row by row, ending in a disabled button (decision D-T1: quotes only, no orders). */
export function QuoteSummary({ quote, token, now, chosenExpireAt, livePrice, onRefresh }: QuoteSummaryProps) {
  const left = secondsLeft(quote.expiresAt, now);
  // A zero market price means "unknown", not a real reference.
  const quoted = quote.marketPriceUsd !== null && isDecimal(quote.marketPriceUsd) && compare(quote.marketPriceUsd, "0") > 0 ? quote.marketPriceUsd : null;
  const reference = quoted ?? livePrice;
  const gap = effectiveGap(quote.effectivePriceUsd, reference);
  const cost = networkCost(quote.spendUsd, quote.receiveUsd);
  const hasFee = isDecimal(quote.feesUsd) && compare(quote.feesUsd, "0") !== 0;
  const steps = [quote.steps.approveTx ? "Approve" : null, quote.steps.permitTypedData ? "Permit" : null, "Sign", "Place"].filter((s): s is string => s !== null);
  const decimals = token.decimals ?? FALLBACK_DECIMALS;
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      <Row label={COPY.you_spend}>
        {quote.spend.amount} {quote.spend.symbol}
        {quote.spendUsd ? <span className="text-mute"> ({formatUsdPrice(quote.spendUsd)})</span> : null}
      </Row>
      <Row label={COPY.you_get}>
        <span className="font-display text-20 font-semibold">{quote.receive.amount} {quote.receive.symbol}</span>
      </Row>
      {quote.effectivePriceUsd ? <Row label={COPY.rate}>{rateLabel(quote.receive.symbol, formatUsdPrice(quote.effectivePriceUsd))}</Row> : null}
      {gap !== null ? <Row label={COPY.effective_vs_market}>{`${gap.startsWith("-") ? "" : "+"}${gap}%`}</Row> : null}
      {cost !== null ? <Row label={COPY.network_cost} hint={COPY.network_cost_hint}>{`$${cost}`}</Row> : null}
      {hasFee ? <Row label={COPY.fees}>{`$${quote.feesUsd}`}</Row> : null}
      {quote.estimatedPriceImpact ? <Row label={COPY.price_impact}>{formatImpact(quote.estimatedPriceImpact)}</Row> : null}
      <Row label={COPY.min_received}>{minReceiveOf(quote, decimals)} {quote.receive.symbol}</Row>
      {quote.orderType === "market" && quote.slippage ? (
        <Row label={COPY.slippage}>
          {`${slippagePercent(quote.slippage)}%`}
          {quote.recommendedSlippage ? <span className="text-mute"> (suggested {slippagePercent(quote.recommendedSlippage)}%)</span> : null}
        </Row>
      ) : null}
      <Row label={COPY.order_expires}>{expiryText(quote, chosenExpireAt, now)}</Row>
      {token.address ? (
        <div className="flex items-center gap-2 text-13 text-mute">
          <span>Token {token.symbol}</span>
          <AddressChip address={token.address} explorer={CHAINS.BASE_MAINNET.explorer} />
          <span>on {CHAINS.BASE_MAINNET.name}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-12 text-mute">
        <span>{COPY.steps}</span>
        {steps.map((s, i) => <span key={s}>({i + 1}) {s}</span>)}
        <Badge tone="amber">{COPY.review_only}</Badge>
        {isMockQuote(quote.quoteId) ? <Badge tone="amber">{COPY.mock_badge}</Badge> : null}
      </div>
      {left === 0 ? (
        <Notice kind="warn" action={<Button size="sm" variant="secondary" onClick={onRefresh}>{COPY.get_new_quote}</Button>}>
          {COPY.quote_expired}
        </Notice>
      ) : (
        <Row label={COPY.quote_valid}>{quoteValidFor(left)}</Row>
      )}
      <Button disabled>{COPY.place_order}</Button>
      <Notice kind="info">{COPY.orders_off}</Notice>
    </div>
  );
}
