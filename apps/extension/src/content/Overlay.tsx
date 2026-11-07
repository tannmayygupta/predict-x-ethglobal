import { Button, Notice } from "@predictx/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HoverStore } from "../x/hoverStore";
import { TokenCard } from "./cards/TokenCard";
import { ESCAPE_EVENT } from "./events";
import { loadMode, type PanelMode } from "./mode";
import { Panel, type PanelTab } from "./Panel";
import { tokenStore } from "./tokens";

interface PanelState {
  open: boolean;
  tab: PanelTab;
  symbol: string;
  /** Bumped when the card opens the panel, so any limit suggested earlier is dropped. */
  fresh: number;
}

/** Launcher pill (bottom right) that opens the PredictX panel, plus the hover card on cashtags. */
export function Overlay({ hover }: { hover: HoverStore }) {
  const [panel, setPanel] = useState<PanelState>({ open: false, tab: "predict", symbol: "", fresh: 0 });
  const [mode, setMode] = useState<PanelMode>(loadMode);
  const hovered = useSyncExternalStore(hover.subscribe, hover.getState, hover.getState);
  const tokens = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, tokenStore.get);
  const token = hovered.symbol ? tokens.find((t) => t.symbol === hovered.symbol) : undefined;

  const closePanel = (): void => setPanel((p) => ({ ...p, open: false }));
  const openPanel = (tab: PanelTab, symbol?: string): void =>
    setPanel((p) => ({ open: true, tab, symbol: symbol ?? (p.symbol || tokens[0]?.symbol || ""), fresh: p.fresh }));
  const openFromCard = (tab: PanelTab, symbol: string): void => {
    hover.close();
    setPanel((p) => ({ open: true, tab, symbol, fresh: p.fresh + 1 }));
  };

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

  // The launcher stays visible in popup mode (it toggles the panel); the sheet and side panel cover its corner.
  const showLauncher = !panel.open || mode === "popup";

  return (
    <>
      {token && hovered.anchor ? (
        <TokenCard
          key={token.symbol}
          token={token}
          anchor={hovered.anchor}
          store={hover}
          onSwap={(symbol) => openFromCard("swap", symbol)}
          onDetails={(symbol) => openFromCard("ai", symbol)}
          onPredict={(symbol) => openFromCard("predict", symbol)}
        />
      ) : null}
      {panel.open ? (
        tokens.length > 0 ? (
          <Panel
            key={panel.fresh}
            tokens={tokens}
            tab={panel.tab}
            symbol={panel.symbol || tokens[0]?.symbol || ""}
            mode={mode}
            onTab={(tab) => setPanel((p) => ({ ...p, tab }))}
            onSymbol={(symbol) => setPanel((p) => ({ ...p, symbol }))}
            onMode={setMode}
            onMinimise={closePanel}
            onClose={closePanel}
          />
        ) : (
          <section aria-label="PredictX" className="px-card-in pointer-events-auto fixed bottom-[76px] right-5 w-[320px] rounded-card border border-rule bg-ink p-4 shadow-card">
            <Notice kind="info">Connecting to the PredictX server...</Notice>
          </section>
        )
      ) : null}
      {showLauncher ? (
        <div className="pointer-events-auto fixed bottom-5 right-5">
          <Button onClick={() => (panel.open ? closePanel() : openPanel(panel.tab))} aria-expanded={panel.open}>
            PredictX
          </Button>
        </div>
      ) : null}
    </>
  );
}
