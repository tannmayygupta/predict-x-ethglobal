import { DURATION_PRESETS_SECONDS, type Token } from "@predictx/shared";
import {
  Button, COPY, Notice, Segmented, TextField, UiError, WalletBar, chainNow, createPool, formatUsdPrice, postablePool, prepareCreate,
  toUiError, useNow, useWallet, type PostablePool, type PreparedPool,
} from "@predictx/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { chain, wallet } from "../wallet";
import { PostStep } from "./PostStep";

type Direction = "above" | "below";
type Phase = { kind: "form" } | { kind: "sending" } | { kind: "error"; error: UiError } | { kind: "done"; pool: PostablePool };

const DURATION_LABELS: Record<number, string> = { 180: "3 min", 3600: "1 hour", 14400: "4 hours", 86400: "24 hours" };
const DURATION_OPTIONS = DURATION_PRESETS_SECONDS.map((s) => ({ value: String(s), label: DURATION_LABELS[s] ?? `${s}s` }));

/** A4: the form builds the exact question that will be stored onchain and shows it before anything is signed. */
export function CreatePanel({ tokens, initialSymbol, onClose }: { tokens: Token[]; initialSymbol: string | null; onClose(): void }) {
  const account = useWallet(wallet);
  const local = useNow();
  const [skew, setSkew] = useState(0);
  const [symbol, setSymbol] = useState(initialSymbol ?? tokens[0]?.symbol ?? "");
  const [direction, setDirection] = useState<Direction>("above");
  const [strike, setStrike] = useState("");
  const [duration, setDuration] = useState(String(DURATION_PRESETS_SECONDS[0]));
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [spot, setSpot] = useState<string | null>(null);

  const token = tokens.find((t) => t.symbol === symbol);

  // The contract judges lead time by block time, so the preview must too: measure how far the local clock is off.
  useEffect(() => {
    chainNow(chain).then((t) => setSkew(t - Math.floor(Date.now() / 1000)), () => undefined);
  }, []);

  useEffect(() => {
    setSpot(null);
    if (!symbol) return;
    let live = true;
    api.market(symbol).then((m) => live && setSpot(m.priceUsd), () => undefined);
    return () => { live = false; };
  }, [symbol]);

  const prepared = useMemo<{ value: PreparedPool | null; error: string | null }>(() => {
    if (!token || strike.trim() === "") return { value: null, error: null };
    try {
      return {
        value: prepareCreate({ symbol: token.symbol, coingeckoId: token.coingeckoId, direction, strikeUsd: strike, durationSeconds: Number(duration) }, local + skew),
        error: null,
      };
    } catch (err) {
      return { value: null, error: toUiError(err).message };
    }
  }, [token, strike, direction, duration, local, skew]);

  const submit = (): void => {
    const toSend = prepared.value;
    if (!toSend) return;
    setPhase({ kind: "sending" });
    // session() is evaluated inside the chain so a wallet that vanished becomes an error, not a stuck "Creating...".
    // postablePool cannot fail, so a pool that exists onchain is never shown as a failed creation.
    Promise.resolve()
      .then(() => createPool(wallet.session(), toSend))
      .then(({ poolId }) => postablePool(chain, poolId, toSend))
      .then((pool) => setPhase({ kind: "done", pool }))
      .catch((err: unknown) => setPhase({ kind: "error", error: toUiError(err) }));
  };

  if (phase.kind === "done") return <PostStep pool={phase.pool} onDone={onClose} />;

  const connected = account.status === "connected";
  const wrongNetwork = connected && account.chainId !== chain.chainId;
  const sending = phase.kind === "sending";

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="m-0 font-display text-20 font-bold">New prediction</h2>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>x</Button>
      </header>

      <label className="flex flex-col gap-1 text-13 text-mute">
        Token
        <select
          value={symbol}
          disabled={sending}
          onChange={(e) => setSymbol(e.target.value)}
          className="h-10 rounded-input border border-rule bg-ink2 px-3 text-14 text-text"
        >
          {tokens.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
        </select>
      </label>
      <Segmented<Direction> label="Will the price be" options={[{ value: "above", label: "Above" }, { value: "below", label: "Below" }]} value={direction} onChange={setDirection} disabled={sending} />
      <TextField
        label="Strike price (USD)"
        value={strike}
        onChange={setStrike}
        inputMode="decimal"
        error={prepared.error}
        hint={spot ? `${symbol} is ${formatUsdPrice(spot)} now` : undefined}
        placeholder={spot ?? undefined}
        disabled={sending}
      />
      <div className="flex flex-col gap-1">
        <span className="text-13 text-mute">Resolves in</span>
        <Segmented label="Resolves in" options={DURATION_OPTIONS} value={duration} onChange={setDuration} disabled={sending} />
      </div>

      <div className="rounded-input border border-rule bg-ink2 p-3 text-14 text-text" aria-live="polite">
        {prepared.value ? prepared.value.question : <span className="text-mute">Your question appears here.</span>}
      </div>
      <span className="text-12 text-mute">Fee: 2% of the pool, paid out to winners.</span>

      {phase.kind === "error" ? <Notice kind="error">{phase.error.message}</Notice> : null}
      <WalletBar controller={wallet} expectedChainId={chain.chainId} />
      {!wrongNetwork ? (
        <Button loading={sending} disabled={!prepared.value || !connected} onClick={submit}>
          {sending ? COPY.creating : COPY.create_cta}
        </Button>
      ) : null}
    </div>
  );
}
