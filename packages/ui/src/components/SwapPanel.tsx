import { MAX_FLASH_TRADE_USD, toUsdcUnits, type FlashQuoteResponse, type Token } from "@predictx/shared";
import { useEffect, useRef, useState } from "react";
import type { ApiClientError } from "../api";
import { useApp } from "../context";
import { COPY } from "../copy";
import { useNow, useWallet } from "../react/useExternal";
import { useMarket } from "../react/useMarket";
import { Button, Notice } from "./primitives";
import { MarketReference, SwapForm, type OrderType } from "./swap/SwapForm";
import { QuoteSummary } from "./swap/QuoteSummary";
import { DEFAULT_SLIPPAGE, expireAtFor, isPositiveDecimal, type ExpiryId } from "./swap/swapMath";
import { WalletBar } from "./wallet";

type QuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiClientError }
  | { kind: "ready"; quote: FlashQuoteResponse; chosenExpireAt: number | null };

const MAX_UNITS = toUsdcUnits(String(MAX_FLASH_TRADE_USD));

function amountError(amount: string): string | null {
  if (amount.trim() === "") return null;
  try {
    const units = toUsdcUnits(amount);
    if (units === 0n) return "Enter an amount above zero.";
    if (units > MAX_UNITS) return COPY.amount_too_high;
    return null;
  } catch {
    return "Enter a number with at most 6 decimals.";
  }
}

function priceError(price: string): string | null {
  if (price.trim() === "") return null;
  return isPositiveDecimal(price) ? null : "Enter a price above zero.";
}

export interface SwapPanelProps {
  token: Token;
  initialLimit: string | null;
  /** Bump this to re-apply the same suggested limit after the user edited the field. */
  limitNonce?: number;
}

/**
 * Real Flash quotes, never an order (decision D-T1). Flash trades on Base mainnet only, and this build uses no
 * mainnet funds: the tab shows exactly what an order would be, then stops at a disabled button. The wallet is
 * used only for its address; it is never asked to switch to mainnet, approve, or sign here.
 */
export function SwapPanel({ token, initialLimit, limitNonce = 0 }: SwapPanelProps) {
  const { api, wallet, chain } = useApp();
  const account = useWallet(wallet);
  const now = useNow();
  const { market } = useMarket(api, token.symbol, now);
  const [amount, setAmount] = useState("");
  const [orderType, setOrderType] = useState<OrderType>(initialLimit ? "limit" : "market");
  const [limitPrice, setLimitPrice] = useState(initialLimit ?? "");
  const [expiry, setExpiry] = useState<ExpiryId>("gtc");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [state, setState] = useState<QuoteState>({ kind: "idle" });
  // Each request gets a number. Editing a field bumps it, so an answer to an older request can never overwrite
  // the screen and look like the quote for what is typed now.
  const latest = useRef(0);
  const reset = (): void => {
    latest.current += 1;
    setState({ kind: "idle" });
  };

  useEffect(() => {
    if (!initialLimit) return;
    setOrderType("limit");
    setLimitPrice(initialLimit);
    reset();
  }, [initialLimit, limitNonce]);

  const aError = amountError(amount);
  const pError = orderType === "limit" ? priceError(limitPrice) : null;
  const ready = amount.trim() !== "" && aError === null && (orderType === "market" || (limitPrice.trim() !== "" && pError === null));
  const suggested = state.kind === "ready" ? state.quote.recommendedSlippage : null;

  const getQuote = (): void => {
    if (!account.address || !ready) return;
    const mine = (latest.current += 1);
    const chosenExpireAt = orderType === "limit" ? expireAtFor(expiry, Math.floor(Date.now() / 1000)) : null;
    setState({ kind: "loading" });
    api
      .flashQuote({
        walletAddress: account.address,
        symbol: token.symbol,
        side: "buy",
        orderType,
        amount,
        limitPriceUsd: orderType === "limit" ? limitPrice : null,
        // Slippage is a market-order setting and expireAt a limit-order one; the contract rejects expireAt on market.
        ...(orderType === "market" ? { slippage } : {}),
        ...(chosenExpireAt !== null ? { expireAt: chosenExpireAt } : {}),
      })
      .then((quote) => { if (mine === latest.current) setState({ kind: "ready", quote, chosenExpireAt }); })
      .catch((error: ApiClientError) => { if (mine === latest.current) setState({ kind: "error", error }); });
  };

  return (
    <div className="flex flex-col gap-3">
      {account.status !== "connected" ? <WalletBar controller={wallet} expectedChainId={chain.chainId} needsChain={false} /> : null}
      <MarketReference symbol={token.symbol} price={market?.priceUsd ?? null} />
      <SwapForm
        amount={amount}
        onAmount={(v) => { setAmount(v); reset(); }}
        amountError={aError}
        orderType={orderType}
        onOrderType={(v) => { setOrderType(v); reset(); }}
        limitPrice={limitPrice}
        onLimitPrice={(v) => { setLimitPrice(v); reset(); }}
        limitError={pError}
        marketPrice={market?.priceUsd ?? null}
        expiry={expiry}
        onExpiry={(v) => { setExpiry(v); reset(); }}
        slippage={slippage}
        onSlippage={(v) => { setSlippage(v); reset(); }}
        suggestedSlippage={suggested}
      />
      <Button loading={state.kind === "loading"} disabled={!ready || account.status !== "connected"} onClick={getQuote}>
        {COPY.get_quote}
      </Button>

      {state.kind === "error" ? <QuoteFailure error={state.error} onRetry={getQuote} /> : null}
      {state.kind === "ready" ? (
        <QuoteSummary
          quote={state.quote}
          token={token}
          now={now}
          chosenExpireAt={state.chosenExpireAt}
          livePrice={market?.priceUsd ?? null}
          onRefresh={getQuote}
        />
      ) : null}
    </div>
  );
}

function QuoteFailure({ error, onRetry }: { error: ApiClientError; onRetry(): void }) {
  const text = error.code === "NETWORK" || error.code === "INTERNAL" ? "Couldn't load the quote. Try again." : error.message;
  return (
    <Notice kind="error" action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>
      {text}
    </Notice>
  );
}
