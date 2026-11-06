import { Button, WalletBar } from "@predictx/ui";
import { useState } from "react";
import { chain, wallet } from "./wallet";

/** Launcher pill (bottom right). The panel it opens becomes the Create panel in M5; today it hosts the wallet. */
export function Overlay() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open ? (
        <section
          aria-label="PredictX"
          className="pointer-events-auto fixed bottom-[72px] right-5 w-[360px] max-w-[calc(100vw-24px)] rounded-card border border-rule bg-ink p-4 shadow-card"
        >
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-20 font-bold">PredictX</h2>
            <Button variant="ghost" size="sm" aria-label="Close" onClick={() => setOpen(false)}>
              x
            </Button>
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
