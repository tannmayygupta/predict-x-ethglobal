import { MAX_FLASH_TRADE_USD } from "@predictx/shared";
import { COPY, flashSuggests, limitGapLabel, slippageLowHint } from "../../copy";
import { formatUsdPrice } from "../../view";
import { Segmented, TextField } from "../forms";
import { Button, cx } from "../primitives";
import {
  EXPIRY_PRESETS,
  LIMIT_PRESETS_PCT,
  SLIPPAGE_PRESETS,
  limitGap,
  limitPresetPrice,
  slippageBelowSuggested,
  slippagePercent,
  type ExpiryId,
} from "./swapMath";

export type OrderType = "market" | "limit";

export interface SwapFormProps {
  amount: string;
  onAmount(value: string): void;
  amountError: string | null;
  orderType: OrderType;
  onOrderType(value: OrderType): void;
  limitPrice: string;
  onLimitPrice(value: string): void;
  limitError: string | null;
  /** Live market price, or null while it loads or after it failed. */
  marketPrice: string | null;
  expiry: ExpiryId;
  onExpiry(value: ExpiryId): void;
  slippage: string;
  onSlippage(value: string): void;
  /** Flash's recommendation from the last quote, if any. */
  suggestedSlippage: string | null;
}

/** Inputs of the swap tab. Pure presentation: every change goes up to SwapPanel, which resets the quote. */
export function SwapForm(props: SwapFormProps) {
  const { orderType, marketPrice, limitPrice } = props;
  const gap = orderType === "limit" && marketPrice ? limitGap(limitPrice, marketPrice) : null;
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Spend (USDC)"
        value={props.amount}
        onChange={props.onAmount}
        inputMode="decimal"
        placeholder="2.00"
        error={props.amountError}
        suffix={`max ${MAX_FLASH_TRADE_USD.toFixed(2)}`}
      />
      <Segmented
        label="Order type"
        options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]}
        value={orderType}
        onChange={props.onOrderType}
      />
      {orderType === "limit" ? (
        <>
          <TextField
            label="Buy when price is at or below"
            value={limitPrice}
            onChange={props.onLimitPrice}
            inputMode="decimal"
            error={props.limitError}
            suffix="USD"
          />
          <div className="flex gap-2" role="group" aria-label="Limit price presets">
            {LIMIT_PRESETS_PCT.map((pct) => (
              <Button key={pct} size="sm" variant="secondary" disabled={!marketPrice} onClick={() => marketPrice && props.onLimitPrice(limitPresetPrice(marketPrice, pct))}>
                {`-${pct}%`}
              </Button>
            ))}
          </div>
          {gap?.kind === "below" ? <span className="text-12 text-mute">{limitGapLabel(gap.pct)}</span> : null}
          {gap?.kind === "at_or_above" ? <span role="alert" className="text-12 text-amber">{COPY.limit_above_market}</span> : null}
          <label className="flex flex-col gap-1 text-13 text-mute">
            {COPY.order_expires}
            <select
              value={props.expiry}
              onChange={(e) => props.onExpiry(e.target.value as ExpiryId)}
              className="h-10 rounded-input border border-rule bg-ink2 px-3 text-14 text-text"
            >
              {EXPIRY_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-13 text-mute">{COPY.slippage}</span>
          <div className="flex gap-2" role="group" aria-label="Slippage presets">
            {SLIPPAGE_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={props.slippage === s}
                onClick={() => props.onSlippage(s)}
                className={cx(
                  "h-8 flex-1 cursor-pointer rounded-input border text-13 font-semibold",
                  props.slippage === s ? "border-amber bg-ink text-amber" : "border-rule bg-ink2 text-mute hover:text-text",
                )}
              >
                {`${slippagePercent(s)}%`}
              </button>
            ))}
          </div>
          {props.suggestedSlippage ? <span className="text-12 text-mute">{flashSuggests(slippagePercent(props.suggestedSlippage))}</span> : null}
          {slippageBelowSuggested(props.slippage, props.suggestedSlippage) && props.suggestedSlippage ? (
            <span className="text-12 text-amber">{slippageLowHint(slippagePercent(props.suggestedSlippage))}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The reference line above the form: what one token costs right now. */
export function MarketReference({ symbol, price }: { symbol: string; price: string | null }) {
  return (
    <div className="flex items-center justify-between text-13 text-mute">
      <span>{`${COPY.market_price_label} (${symbol})`}</span>
      <span className="px-tnum text-14 font-semibold text-text">{price ? formatUsdPrice(price) : "—"}</span>
    </div>
  );
}
