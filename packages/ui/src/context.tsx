import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { ApiClient } from "./api";
import { chainNow, type ChainClients } from "./chain";
import { setClockOffset } from "./react/useExternal";
import { CLOCK_SKEW_THRESHOLD_SECONDS } from "./view";
import type { WalletController } from "./wallet";

/**
 * What the shared screens need from their host. The extension builds these with a service-worker transport and a
 * page-bridge wallet; the dashboard builds them with fetch and MetaMask directly. The screens never know which.
 */
export interface AppServices {
  api: ApiClient;
  wallet: WalletController;
  chain: ChainClients;
  dashboardUrl: string;
}

const AppContext = createContext<AppServices | null>(null);

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  // One best-effort read of the chain's time. A clock that is only a block off is left alone; a real skew is corrected.
  useEffect(() => {
    let live = true;
    chainNow(services.chain).then(
      (chainTime) => {
        const offset = chainTime - Math.floor(Date.now() / 1000);
        if (live && Math.abs(offset) >= CLOCK_SKEW_THRESHOLD_SECONDS) setClockOffset(offset);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [services.chain]);
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>;
}

export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error("useApp must be used inside <AppProvider>");
  return services;
}
