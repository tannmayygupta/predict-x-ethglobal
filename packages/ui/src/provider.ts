/**
 * The wallet provider contract and MetaMask discovery. Kept free of React and viem so the extension's page-side
 * script (which runs inside x.com's own JavaScript world) stays tiny.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}


const METAMASK_RDNS = "io.metamask";
const DISCOVERY_TIMEOUT_MS = 400;

interface Announcement {
  info?: { rdns?: unknown };
  provider?: Eip1193Provider;
}

/** EIP-6963 first (so Phantom or Coinbase overwriting window.ethereum cannot hide MetaMask), then the legacy global. */
export function discoverMetaMask(timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<Eip1193Provider | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (provider: Eip1193Provider | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(provider ?? legacyMetaMask());
    };
    const onAnnounce = (event: Event): void => {
      const detail = (event as CustomEvent<Announcement>).detail;
      if (detail?.info?.rdns === METAMASK_RDNS && detail.provider) finish(detail.provider);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  });
}

function legacyMetaMask(): Eip1193Provider | null {
  const eth = (window as unknown as { ethereum?: Eip1193Provider & { isMetaMask?: boolean } }).ethereum;
  return eth?.isMetaMask ? eth : null;
}

