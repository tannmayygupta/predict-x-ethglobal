import { useEffect, useState, useSyncExternalStore } from "react";
import type { WalletController, WalletState } from "../wallet";

export function useWallet(controller: WalletController): WalletState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

/** Seconds since the epoch, re-read every second; drives countdowns without each one owning a timer. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
