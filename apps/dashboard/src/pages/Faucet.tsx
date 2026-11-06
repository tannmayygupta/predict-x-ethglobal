import { formatUsdc } from "@predictx/shared";
import { Button, Notice, UiError, mintTestUsdc, readUsdcBalance, startPolling, toUiError, useWallet } from "@predictx/ui";
import { useEffect, useRef, useState } from "react";
import { useToast } from "../components/Toast";
import { chain, wallet } from "../services";

const MINT_AMOUNT = "100";
const BALANCE_REFRESH_MS = 10_000;
// Public Base Sepolia ETH faucet for gas; the page itself only mints test USDC.
const GAS_FAUCET_URL = "https://portal.cdp.coinbase.com/products/faucet";

/** D3: mint free test USDC (it has no value and only exists on Base Sepolia). */
export function Faucet() {
  const account = useWallet(wallet);
  const toast = useToast();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const reload = useRef<() => void>(() => undefined);

  useEffect(() => {
    setBalance(null);
    if (!account.address) return;
    const holder = account.address;
    const poller = startPolling(() => readUsdcBalance(chain, holder), BALANCE_REFRESH_MS, {
      onData: setBalance,
      onError: () => undefined,
    });
    reload.current = poller.refresh;
    return poller.stop;
  }, [account.address]);

  const ready = account.status === "connected" && account.chainId === chain.chainId;
  const mint = (): void => {
    setBusy(true);
    setError(null);
    mintTestUsdc(wallet.session(), MINT_AMOUNT)
      .then(() => {
        toast(`Minted ${MINT_AMOUNT} USDC`);
        reload.current();
      })
      .catch((err: unknown) => setError(toUiError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-8">
      <h1 className="font-display text-28 font-bold">Get test USDC</h1>
      <p className="text-14 text-mute">Test USDC works only on Base Sepolia. It has no value.</p>
      {account.status === "connected" ? (
        <p className="text-14">Your balance <b className="font-display">{balance === null ? "..." : `${formatUsdc(balance)} USDC`}</b></p>
      ) : null}
      {error ? <Notice kind="error">{error.message}</Notice> : null}
      <div>
        <Button loading={busy} disabled={!ready} onClick={mint}>{busy ? "Waiting for wallet..." : `Get ${MINT_AMOUNT} USDC`}</Button>
      </div>
      {!ready ? <p className="text-13 text-mute">Connect your wallet on Base Sepolia (top right) to mint.</p> : null}
      <p className="text-13 text-mute">Need gas? Get Base Sepolia ETH from a <a href={GAS_FAUCET_URL} target="_blank" rel="noreferrer noopener" className="text-amber">faucet</a>.</p>
    </main>
  );
}
