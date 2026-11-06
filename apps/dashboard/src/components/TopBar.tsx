import { WalletBar } from "@predictx/ui";
import { NavLink, Link } from "react-router-dom";
import { chain, wallet } from "../services";

const link = ({ isActive }: { isActive: boolean }): string =>
  `rounded-button px-3 py-2 text-14 font-semibold no-underline ${isActive ? "bg-ink2 text-amber" : "text-mute"}`;

/** 64 px bar: brand, Pools, Faucet, and the wallet on the right. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-page">
      <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-display text-20 font-bold text-text no-underline">PredictX</Link>
          <nav className="flex gap-1" aria-label="Main">
            <NavLink to="/" end className={link}>Pools</NavLink>
            <NavLink to="/faucet" className={link}>Faucet</NavLink>
          </nav>
        </div>
        <div className="w-[260px] max-w-[50vw]">
          <WalletBar controller={wallet} expectedChainId={chain.chainId} />
        </div>
      </div>
    </header>
  );
}
