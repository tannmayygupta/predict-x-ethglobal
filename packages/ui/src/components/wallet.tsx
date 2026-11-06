import { CHAINS } from "@predictx/shared";
import { useEffect, useState } from "react";
import type { UiError } from "../errors";
import { toUiError } from "../errors";
import { COPY } from "../copy";
import { useWallet } from "../react/useExternal";
import type { WalletController } from "../wallet";
import { Button, Notice, cx } from "./primitives";

const COPIED_MS = 1500;

export const shortAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;

/** Short address with a copy button and an explorer link. */
export function AddressChip({ address, explorer }: { address: string; explorer?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (): void => {
    navigator.clipboard.writeText(address).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <span className="inline-flex items-center gap-2 text-13 text-mute">
      {explorer ? (
        <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer noopener" className="text-mute underline">
          {shortAddress(address)}
        </a>
      ) : (
        <span>{shortAddress(address)}</span>
      )}
      <button type="button" onClick={copy} className="cursor-pointer rounded-input border border-rule bg-ink2 px-2 text-12 text-text" aria-label="Copy address">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

const CHAIN_NAMES: Record<number, string> = { [CHAINS.BASE_MAINNET.id]: CHAINS.BASE_MAINNET.name, [CHAINS.BASE_SEPOLIA.id]: CHAINS.BASE_SEPOLIA.name };

/** The wallet's network; the amber dot shows it is not the one this action needs. */
export function NetworkPill({ chainId, expected }: { chainId: number | null; expected: number }) {
  const wrong = chainId !== null && chainId !== expected;
  const name = chainId === null ? CHAIN_NAMES[expected] : (CHAIN_NAMES[chainId] ?? `Chain ${chainId}`);
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-input border border-rule px-2 text-12 text-mute">
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", wrong ? "bg-amber" : "bg-yes")} />
      {name}
    </span>
  );
}

/** Asks the wallet for Base Sepolia and says why when it cannot (rejected, a request already pending, locked wallet). */
export function SwitchNetworkButton({ controller, size = "md" }: { controller: WalletController; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const run = (): void => {
    setBusy(true);
    setError(null);
    controller
      .switchToPoolChain()
      .catch((err: unknown) => setError(toUiError(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-2">
      <Button size={size} loading={busy} onClick={run}>
        {COPY.switch_base_sepolia}
      </Button>
      {error ? <Notice kind={error.code === "USER_REJECTED" ? "info" : "error"}>{error.message}</Notice> : null}
    </div>
  );
}

/** Connect, show the account and network, or offer the switch. Every action that needs a wallet shows this. */
export function WalletBar({
  controller,
  expectedChainId,
  needsChain = true,
}: {
  controller: WalletController;
  expectedChainId: number;
  /** False when the action only needs the address (for example a quote), so a different network is fine. */
  needsChain?: boolean;
}) {
  const wallet = useWallet(controller);
  if (wallet.status === "no-wallet") return <Notice kind="warn">{COPY.no_wallet}</Notice>;
  if (wallet.status === "disconnected" || wallet.status === "connecting") {
    return (
      <div className="flex flex-col gap-2">
        <Button size="sm" loading={wallet.status === "connecting"} onClick={() => void controller.connect()}>
          {COPY.connect_wallet}
        </Button>
        {wallet.error ? <Notice kind="error">{wallet.error.message}</Notice> : null}
      </div>
    );
  }
  const wrong = needsChain && wallet.chainId !== expectedChainId;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {wallet.address ? <AddressChip address={wallet.address} /> : null}
        <NetworkPill chainId={wallet.chainId} expected={needsChain ? expectedChainId : (wallet.chainId ?? expectedChainId)} />
      </div>
      {wrong ? <SwitchNetworkButton controller={controller} size="sm" /> : null}
    </div>
  );
}
