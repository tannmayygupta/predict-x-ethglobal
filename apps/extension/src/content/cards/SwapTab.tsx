import { CHAINS, MAX_FLASH_TRADE_USD, toUsdcUnits, type FlashQuoteResponse, type Token } from "@predictx/shared";
import {
  AddressChip, Badge, Button, COPY, Notice, Segmented, TextField, WalletBar, formatImpact, isMockQuote, useNow, useWallet,
  type ApiClientError,
} from "@predictx/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { chain, wallet } from "../wallet";

type OrderType = "market" | "limit";
type QuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiClientError }
  | { kind: "ready"; quote: FlashQuoteResponse };

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
  return /^\d+(\.\d+)?$/.test(price) && Number(price) > 0 ? null : "Enter a price above zero.";
}

/**
 * Real Flash quotes, never an order (decision D-T1). Flash trades on Base mainnet only, and this build uses no
 * mainnet funds: the tab shows exactly what an order would be, then stops at a disabled button. The wallet is
 * used only for its address; it is never asked to switch to mainnet, approve, or sign here.
 */
export function SwapTab({ token, initialLimit }: { token: Token; initialLimit: string | null }) {
  const account = useWallet(wallet);
  const now = useNow();
  const [amount, setAmount] = useState("");
  const [orderType, setOrderType] = useState<OrderType>(initialLimit ? "limit" : "market");
  const [limitPrice, setLimitPrice] = useState(initialLimit ?? "");
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
    latest.current += 1;
    setState({ kind: "idle" });
  }, [initialLimit]);

  const aError = amountError(amount);
  const pError = orderType === "limit" ? priceError(limitPrice) : null;
  const ready = amount.trim() !== "" && aError === null && (orderType === "market" || (limitPrice.trim() !== "" && pError === null));

  const getQuote = (): void => {
    if (!account.address || !ready) return;
    const mine = (latest.current += 1);
    setState({ kind: "loading" });
    api
      .flashQuote({
        walletAddress: account.address,
        symbol: token.symbol,
        side: "buy",
        orderType,
        amount,
        limitPriceUsd: orderType === "limit" ? limitPrice : null,
      })
      .then((quote) => { if (mine === latest.current) setState({ kind: "ready", quote }); })
      .catch((error: ApiClientError) => { if (mine === latest.current) setState({ kind: "error", error }); });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {account.status !== "connected" ? <WalletBar controller={wallet} expectedChainId={chain.chainId} needsChain={false} /> : null}
      <TextField
        label="Spend (USDC)"
        value={amount}
        onChange={(v) => { setAmount(v); reset(); }}
        inputMode="decimal"
        placeholder="2.00"
        error={aError}
        suffix={`max ${MAX_FLASH_TRADE_USD.toFixed(2)}`}
      />
      <Segmented
        label="Order type"
        options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]}
        value={orderType}
        onChange={(v) => { setOrderType(v); reset(); }}
      />
      {orderType === "limit" ? (
        <TextField
          label={`Buy when price is at or below`}
          value={limitPrice}
          onChange={(v) => { setLimitPrice(v); reset(); }}
          inputMode="decimal"
          error={pError}
          suffix="USD"
        />
      ) : null}
      <Button loading={state.kind === "loading"} disabled={!ready || account.status !== "connected"} onClick={getQuote}>
        {COPY.get_quote}
      </Button>

      {state.kind === "error" ? <QuoteFailure error={state.error} onRetry={getQuote} /> : null}
      {state.kind === "ready" ? <QuoteSummary quote={state.quote} token={token} now={now} onRefresh={getQuote} /> : null}
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

function QuoteSummary({ quote, token, now, onRefresh }: { quote: FlashQuoteResponse; token: Token; now: number; onRefresh(): void }) {
  const left = quote.expiresAt - now;
  const expired = left <= 0;
  const steps = [quote.steps.approveTx ? "Approve" : null, quote.steps.permitTypedData ? "Permit" : null, "Sign", "Place"].filter((s): s is string => s !== null);
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      <div className="flex items-center justify-between">
        <span className="text-13 text-mute">You spend</span>
        <span className="font-display text-14 font-semibold">{quote.spend.amount} {quote.spend.symbol}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-13 text-mute">You get</span>
        <span className="font-display text-20 font-semibold">about {quote.receive.amount} {quote.receive.symbol}</span>
      </div>
      <div className="flex items-center justify-between text-13 text-mute">
        <span>Fees ${quote.feesUsd}</span>
        {quote.estimatedPriceImpact ? <span>Price impact {formatImpact(quote.estimatedPriceImpact)}</span> : null}
      </div>
      {token.address ? (
        <div className="flex items-center gap-2 text-13 text-mute">
          <span>Token {token.symbol}</span>
          <AddressChip address={token.address} explorer={CHAINS.BASE_MAINNET.explorer} />
          <span>on {CHAINS.BASE_MAINNET.name}</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-12 text-mute">
        <span>Steps</span>
        {steps.map((s, i) => <span key={s}>({i + 1}) {s}</span>)}
        <Badge tone="amber">{COPY.review_only}</Badge>
        {isMockQuote(quote.quoteId) ? <Badge tone="amber">{COPY.mock_badge}</Badge> : null}
      </div>
      {expired ? (
        <Notice kind="warn" action={<Button size="sm" variant="secondary" onClick={onRefresh}>{COPY.get_quote}</Button>}>
          {COPY.quote_expired}
        </Notice>
      ) : (
        <span className="text-12 text-mute">Quote valid for {left}s</span>
      )}
      <Button disabled>{COPY.place_order}</Button>
      <Notice kind="info">{COPY.orders_off}</Notice>
    </div>
  );
}
