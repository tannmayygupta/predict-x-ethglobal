import { Button, Notice } from "@predictx/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HoverStore } from "../x/hoverStore";
import { TokenCard } from "./cards/TokenCard";
import { CreatePanel } from "./create/CreatePanel";
import { ESCAPE_EVENT } from "./events";
import { tokenStore } from "./tokens";

/** Launcher pill (bottom right) that opens the Create panel, plus the hover card. */
export function Overlay({ hover }: { hover: HoverStore }) {
  const [panel, setPanel] = useState<{ open: boolean; symbol: string | null; run: number }>({ open: false, symbol: null, run: 0 });
  const closePanel = (): void => setPanel((p) => ({ ...p, open: false }));
  const openPanel = (symbol: string | null): void => setPanel((p) => ({ open: true, symbol, run: p.run + 1 }));
  const hovered = useSyncExternalStore(hover.subscribe, hover.getState, hover.getState);
  const tokens = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, tokenStore.get);
  const token = hovered.symbol ? tokens.find((t) => t.symbol === hovered.symbol) : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      hover.close();
      closePanel();
    };
    const onEscape = (): void => {
      hover.close();
      closePanel();
    };
    document.addEventListener("keydown", onKey);
    // Escape pressed inside our own inputs is stopped at our host (so x.com shortcuts stay quiet) and arrives here.
    window.addEventListener(ESCAPE_EVENT, onEscape);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(ESCAPE_EVENT, onEscape);
    };
  }, [hover]);

  return (
    <>
      {token && hovered.anchor ? <TokenCard key={token.symbol} token={token} anchor={hovered.anchor} store={hover} onPredict={(symbol) => { hover.close(); openPanel(symbol); }} /> : null}
      {panel.open ? (
        <section
          aria-label="PredictX"
          className="px-card-in pointer-events-auto fixed bottom-[72px] right-5 max-h-[calc(100vh-96px)] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-card border border-rule bg-ink p-4 text-text shadow-card"
        >
          {tokens.length > 0 ? (
            <CreatePanel key={panel.run} tokens={tokens} initialSymbol={panel.symbol} onClose={closePanel} />
          ) : (
            <Notice kind="info">Connecting to the PredictX server...</Notice>
          )}
        </section>
      ) : null}
      <div className="pointer-events-auto fixed bottom-5 right-5">
        <Button onClick={() => (panel.open ? closePanel() : openPanel(null))} aria-expanded={panel.open}>
          PredictX
        </Button>
      </div>
    </>
  );
}
