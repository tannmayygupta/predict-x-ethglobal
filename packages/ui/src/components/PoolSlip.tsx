import { buildResultTweetText, formatUsdc, toUsdcUnits, type Pool, type Position } from "@predictx/shared";
import { useState, type CSSProperties } from "react";
import { FAUCET_MINT_USDC, claim, mintTestUsdc, refund, stake, type StakeStep } from "../actions";
import type { ChainClients } from "../chain";
import { COPY, approveAmount, claimAmount, closesIn, refundAmount } from "../copy";
import { UiError, toUiError } from "../errors";
import { useNow, useWallet } from "../react/useExternal";
import { openComposer } from "../share";
import { effectiveStatus, formatCountdown, formatUsdPrice, poolSize } from "../view";
import type { WalletController } from "../wallet";
import { TextField } from "./forms";
import { SwitchNetworkButton } from "./wallet";
import { OddsBar } from "./odds";
import { Button, Notice } from "./primitives";

export type SlipEvent = "bet" | "claim" | "refund";

export interface PoolSlipProps {
  pool: Pool;
  position: Position | null;
  controller: WalletController;
  chain: ChainClients;
  /** Where "Get test USDC" points (the dashboard's /faucet). */
  faucetUrl: string;
  /** The colour behind the slip, so the two tear-line notches look cut out of it. */
  background?: string;
  onChanged(event: SlipEvent): void;
}

type Busy = "approving" | "staking" | "claiming" | "refunding" | null;

const sideAmount = (units: string): string => formatUsdc(units);

/** The Odds Slip (A6/D2): question, tear line, odds, then whatever the pool's state allows. */
export function PoolSlip(props: PoolSlipProps) {
  const { pool, background } = props;
  const now = useNow();
  const status = effectiveStatus(pool, now);
  return (
    <div className="px-slip text-text" style={background ? ({ "--px-slip-bg": background } as CSSProperties) : undefined}>
      <div className="flex flex-col gap-1 p-4">
        <p className="m-0 line-clamp-2 font-display text-16 font-semibold">{pool.question}</p>
        <div className="flex justify-between text-13 text-mute">
          <span>{status === "open" ? closesIn(formatCountdown(pool.resolveTime, now)) : "Closed"}</span>
          <span>Pool {poolSize(pool.yesTotal, pool.noTotal)} USDC</span>
        </div>
      </div>
      <div className="px-slip__tear" />
      <div className="flex flex-col gap-3 p-4">
        <OddsBar yesTotal={pool.yesTotal} noTotal={pool.noTotal} />
        {status === "open" ? <BetForm {...props} /> : null}
        {status === "awaiting" ? <p className="m-0 text-14 font-semibold text-amber">{COPY.closed_waiting}</p> : null}
        {status === "resolved" ? <ResolvedBlock {...props} /> : null}
        {status === "void" ? <VoidBlock {...props} /> : null}
      </div>
    </div>
  );
}

function useTx(controller: WalletController) {
  const wallet = useWallet(controller);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<UiError | null>(null);
  return { wallet, busy, setBusy, error, setError };
}

/** Gate shared by every action: connect first, then be on Base Sepolia. Returns the node to show, or null if ready. */
function WalletGate({ controller, chain }: { controller: WalletController; chain: ChainClients }) {
  const wallet = useWallet(controller);
  if (wallet.status === "no-wallet") return <Notice kind="warn">{COPY.no_wallet}</Notice>;
  if (wallet.status !== "connected") {
    return <Button loading={wallet.status === "connecting"} onClick={() => void controller.connect()}>{COPY.connect_wallet}</Button>;
  }
  if (wallet.chainId !== chain.chainId) {
    return <SwitchNetworkButton controller={controller} />;
  }
  return null;
}

/** The wallet has no test USDC: one button mints some right here, so the user never has to leave the post. */
function FundNotice({ controller, faucetUrl, onFunded }: { controller: WalletController; faucetUrl: string; onFunded(): void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UiError | null>(null);
  const mint = (): void => {
    setBusy(true);
    setFailure(null);
    // session() is read inside the chain so a wallet that vanished becomes an error, not a stuck spinner.
    Promise.resolve()
      .then(() => mintTestUsdc(controller.session(), FAUCET_MINT_USDC))
      .then(onFunded)
      .catch((err: unknown) => setFailure(toUiError(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-2">
      <Notice kind="warn" action={<Button size="sm" variant="secondary" loading={busy} onClick={mint}>{busy ? COPY.waiting_wallet : COPY.get_test_usdc}</Button>}>
        {COPY.need_usdc}
      </Notice>
      {failure ? (
        <Notice
          kind={failure.code === "USER_REJECTED" ? "info" : "error"}
          action={<a href={faucetUrl} target="_blank" rel="noreferrer noopener" className="text-amber underline">Open faucet</a>}
        >
          {failure.message}
        </Notice>
      ) : null}
    </div>
  );
}

function ErrorLine({ error, controller, faucetUrl, onFunded = () => undefined }: { error: UiError | null; controller: WalletController; faucetUrl: string; onFunded?: () => void }) {
  if (!error || error.code === "USER_REJECTED") return error ? <Notice kind="info">{error.message}</Notice> : null;
  if (error.code === "NEED_USDC") return <FundNotice controller={controller} faucetUrl={faucetUrl} onFunded={onFunded} />;
  return <Notice kind="error">{error.message}</Notice>;
}

function BetForm({ pool, controller, chain, faucetUrl, onChanged }: PoolSlipProps) {
  const { wallet, busy, setBusy, error, setError } = useTx(controller);
  const [amount, setAmount] = useState("");
  const [funded, setFunded] = useState(false);
  const gate = <WalletGate controller={controller} chain={chain} />;
  const parsed = (() => {
    if (amount.trim() === "") return { ok: false as const, message: null };
    try {
      return toUsdcUnits(amount) > 0n ? { ok: true as const } : { ok: false as const, message: "Enter an amount above zero." };
    } catch {
      return { ok: false as const, message: "Enter an amount with at most 6 decimals." };
    }
  })();

  const bet = (isYes: boolean): void => {
    if (!parsed.ok) return;
    setError(null);
    setFunded(false);
    setBusy("approving");
    const onStep = (step: StakeStep): void => setBusy(step);
    Promise.resolve()
      .then(() => stake(controller.session(), { poolId: pool.id, isYes, amountUsdc: amount }, onStep))
      .then(() => {
        setAmount("");
        onChanged("bet");
      })
      .catch((err: unknown) => setError(toUiError(err)))
      .finally(() => setBusy(null));
  };

  const ready = wallet.status === "connected" && wallet.chainId === chain.chainId;
  return (
    <div className="flex flex-col gap-3">
      <TextField label="Amount" value={amount} onChange={setAmount} inputMode="decimal" placeholder="5.00" suffix="USDC" error={parsed.ok ? null : parsed.message} disabled={busy !== null} />
      {busy === "approving" ? <Notice kind="info">{approveAmount(amount)}. {COPY.confirm_wallet}</Notice> : null}
      {busy === "staking" ? <Notice kind="info">{COPY.confirm_wallet}</Notice> : null}
      <ErrorLine error={error} controller={controller} faucetUrl={faucetUrl} onFunded={() => { setError(null); setFunded(true); }} />
      {funded && !error ? <Notice kind="info">{COPY.minted}</Notice> : null}
      {ready ? (
        <div className="flex gap-2">
          <div className="flex-1"><Button variant="yes" loading={busy !== null} disabled={!parsed.ok} onClick={() => bet(true)}>{busy ? COPY.waiting_wallet : COPY.bet_yes}</Button></div>
          <div className="flex-1"><Button variant="no" loading={busy !== null} disabled={!parsed.ok} onClick={() => bet(false)}>{busy ? COPY.waiting_wallet : COPY.bet_no}</Button></div>
        </div>
      ) : (
        gate
      )}
    </div>
  );
}

function stakedText(position: Position | null): string | null {
  if (!position) return null;
  const parts: string[] = [];
  if (position.yesStake !== "0") parts.push(`${sideAmount(position.yesStake)} YES`);
  if (position.noStake !== "0") parts.push(`${sideAmount(position.noStake)} NO`);
  return parts.length ? `You staked ${parts.join(" and ")}.` : null;
}

/** After a pool closes: one click opens an X draft announcing the result (it carries the PX# marker, so the bet box shows the result under it too). */
function ShareResult({ pool }: { pool: Pool }) {
  let text: string | null = null;
  try {
    text = buildResultTweetText({
      id: pool.id,
      question: pool.question,
      outcome: pool.outcome,
      priceLabel: pool.resolvedPriceUsd ? formatUsdPrice(pool.resolvedPriceUsd) : null,
      dashboardUrl: pool.dashboardUrl,
    });
  } catch {
    return null; // too long to post: the link and the result are still on the page
  }
  const draft = text;
  return <Button variant="secondary" size="sm" onClick={() => openComposer(draft)}>{COPY.share_result}</Button>;
}

function ResolvedBlock({ pool, position, controller, chain, faucetUrl, onChanged }: PoolSlipProps) {
  const { busy, setBusy, error, setError } = useTx(controller);
  const yes = pool.outcome === "yes";
  const staked = stakedText(position);
  const claimable = position?.claimable ?? "0";
  const winningStake = position ? (yes ? position.yesStake : position.noStake) : "0";
  const outcomeLine = claimable !== "0" ? `You can claim ${formatUsdc(claimable)} USDC.` : winningStake !== "0" ? "Claimed." : "Better luck next time.";

  const run = (): void => {
    setError(null);
    setBusy("claiming");
    Promise.resolve()
      .then(() => claim(controller.session(), pool.id))
      .then(() => onChanged("claim"))
      .catch((err: unknown) => setError(toUiError(err)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className={`m-0 font-display text-16 font-semibold ${yes ? "text-yes" : "text-no"}`}>
        {yes ? COPY.result_yes : COPY.result_no}
        {pool.resolvedPriceUsd ? <span className="ml-2 text-13 font-normal text-mute">Price at close ${pool.resolvedPriceUsd}</span> : null}
      </p>
      <p className="m-0 text-12 text-mute">{COPY.settled_by}</p>
      {staked ? <p className="m-0 text-14">{staked} {outcomeLine}</p> : null}
      <ErrorLine error={error} controller={controller} faucetUrl={faucetUrl} />
      {claimable !== "0" ? <ClaimButton controller={controller} chain={chain} busy={busy === "claiming"} label={claimAmount(formatUsdc(claimable))} onClick={run} /> : null}
      <div><ShareResult pool={pool} /></div>
    </div>
  );
}

function VoidBlock({ pool, position, controller, chain, faucetUrl, onChanged }: PoolSlipProps) {
  const { busy, setBusy, error, setError } = useTx(controller);
  const refundable = position?.refundable ?? "0";
  const run = (): void => {
    setError(null);
    setBusy("refunding");
    Promise.resolve()
      .then(() => refund(controller.session(), pool.id))
      .then(() => onChanged("refund"))
      .catch((err: unknown) => setError(toUiError(err)))
      .finally(() => setBusy(null));
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-14 text-text">{COPY.void_note}</p>
      <ErrorLine error={error} controller={controller} faucetUrl={faucetUrl} />
      {refundable !== "0" ? <ClaimButton controller={controller} chain={chain} busy={busy === "refunding"} label={refundAmount(formatUsdc(refundable))} onClick={run} /> : null}
      <div><ShareResult pool={pool} /></div>
    </div>
  );
}

/** Claim and refund share one rule: the wallet must be connected and on Base Sepolia before the button appears. */
function ClaimButton({ controller, chain, busy, label, onClick }: { controller: WalletController; chain: ChainClients; busy: boolean; label: string; onClick(): void }) {
  const wallet = useWallet(controller);
  const ready = wallet.status === "connected" && wallet.chainId === chain.chainId;
  if (!ready) return <WalletGate controller={controller} chain={chain} />;
  return <Button loading={busy} onClick={onClick}>{busy ? COPY.waiting_wallet : label}</Button>;
}
