import { Button, WalletBar } from "@predictx/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HoverStore } from "../x/hoverStore";
import { TokenCard } from "./cards/TokenCard";
import { tokenStore } from "./tokens";
import { chain, wallet } from "./wallet";

/** Launcher pill (bottom right) plus the hover card. The pill's panel becomes the Create panel in M5. */
export function Overlay({ hover }: { hover: HoverStore }) {
  const [open, setOpen] = useState(false);
  const hovered = useSyncExternalStore(hover.subscribe, hover.getState, hover.getState);
  const tokens = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, tokenStore.get);
  const token = hovered.symbol ? tokens.find((t) => t.symbol === hovered.symbol) : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      hover.close();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hover]);

  return (
    <>
      {token && hovered.anchor ? <TokenCard key={token.symbol} token={token} anchor={hovered.anchor} store={hover} /> : null}
      {open ? (
        <section
          aria-label="PredictX"
          className="px-card-in pointer-events-auto fixed bottom-[72px] right-5 w-[360px] max-w-[calc(100vw-24px)] rounded-card border border-rule bg-ink p-4 text-text shadow-card"
        >
          <header className="mb-3 flex items-center justify-between">
            <h2 className="m-0 font-display text-20 font-bold">PredictX</h2>
            <Button variant="ghost" size="sm" aria-label="Close" onClick={() => setOpen(false)}>x</Button>
          </header>
          <WalletBar controller={wallet} expectedChainId={chain.chainId} />
        </section>
      ) : null}
      <div className="pointer-events-auto fixed bottom-5 right-5">
        <Button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          PredictX
        </Button>
      </div>
    </>
  );
}
