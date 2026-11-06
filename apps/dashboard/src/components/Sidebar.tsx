import { WalletBar } from "@predictx/ui";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { chain, wallet } from "../services";

const ICON = "h-4 w-4 shrink-0";

const PoolsIcon = (
  <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M2 8h12" strokeDasharray="2 2" />
  </svg>
);

const FaucetIcon = (
  <svg className={ICON} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 2.5c2 2.6 3.5 4.3 3.5 6.2a3.5 3.5 0 0 1-7 0C4.5 6.8 6 5.1 8 2.5Z" />
  </svg>
);

const item = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-3 rounded-button px-3 py-2 text-14 font-semibold no-underline ${isActive ? "bg-ink2 text-amber" : "text-mute hover:bg-ink hover:text-text"}`;

function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={item}>
      {icon}
      {children}
    </NavLink>
  );
}

/** Left navigation: brand, pages, then the wallet and the network at the bottom. Becomes a top bar on narrow screens. */
export function Sidebar() {
  return (
    <aside className="flex flex-col gap-4 border-b border-rule bg-ink p-4 min-[800px]:sticky min-[800px]:top-0 min-[800px]:h-screen min-[800px]:border-b-0 min-[800px]:border-r">
      <Link to="/" className="font-display text-20 font-bold text-text no-underline">
        Predict<span className="text-amber">X</span>
      </Link>
      <nav className="flex gap-1 min-[800px]:flex-col" aria-label="Main">
        <NavItem to="/" end icon={PoolsIcon}>Pools</NavItem>
        <NavItem to="/faucet" icon={FaucetIcon}>Faucet</NavItem>
      </nav>
      <div className="flex flex-col gap-3 min-[800px]:mt-auto">
        <p className="text-12 text-mute">Base Sepolia · test funds only</p>
        <WalletBar controller={wallet} expectedChainId={chain.chainId} />
      </div>
    </aside>
  );
}
