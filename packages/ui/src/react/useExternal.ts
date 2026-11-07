import { useEffect, useState, useSyncExternalStore } from "react";
import type { WalletController, WalletState } from "../wallet";

export function useWallet(controller: WalletController): WalletState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

let clockOffsetSeconds = 0;

/**
 * Moves every countdown onto the chain's clock. The contract closes betting by block time, so a viewer whose computer
 * clock is minutes off would otherwise see a pool open (or closed) when it is not. Set once at start by AppProvider.
 */
export function setClockOffset(seconds: number): void {
  clockOffsetSeconds = seconds;
}

export function getClockOffset(): number {
  return clockOffsetSeconds;
}

/** Seconds since the epoch on the corrected clock. Use this, not Date.now(), for anything compared with chain or server time. */
export function currentSeconds(): number {
  return Math.floor(Date.now() / 1000) + clockOffsetSeconds;
}

/** Seconds since the epoch, re-read every second; drives countdowns without each one owning a timer. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(currentSeconds);
  useEffect(() => {
    const timer = setInterval(() => setNow(currentSeconds()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
