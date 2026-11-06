import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./api";
import type { ChainClients } from "./chain";
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
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>;
}

export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error("useApp must be used inside <AppProvider>");
  return services;
}
