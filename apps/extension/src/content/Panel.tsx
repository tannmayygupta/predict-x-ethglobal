import type { Token } from "@predictx/shared";
import { CreatePrediction, InsightPanel, SwapPanel, Tabs, TokenPicker, cx, type LimitSuggestion } from "@predictx/ui";
import { useEffect, useState, type ReactNode } from "react";
import { saveMode, type PanelMode } from "./mode";

export type PanelTab = "ai" | "swap" | "predict";

const TABS: ReadonlyArray<{ value: PanelTab; label: string }> = [
  { value: "ai", label: "AI" },
  { value: "swap", label: "Swap" },
  { value: "predict", label: "Predict" },
];

const ICON = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;
const MODE_BUTTONS: ReadonlyArray<{ mode: PanelMode; label: string; icon: ReactNode }> = [
  { mode: "popup", label: "Popup", icon: <svg {...ICON}><rect x="3" y="3" width="10" height="10" rx="2" /></svg> },
  { mode: "sheet", label: "Slide-up", icon: <svg {...ICON}><rect x="2" y="7" width="12" height="7" rx="2" /><path d="M6 4.5 8 2.5l2 2" /></svg> },
  { mode: "side", label: "Side panel", icon: <svg {...ICON}><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M10 3v10" /></svg> },
];

const FRAME: Record<PanelMode, string> = {
  popup: "bottom-[76px] right-5 max-h-[calc(100vh-100px)] w-[400px] max-w-[calc(100vw-24px)] rounded-card border",
  // Centred with auto margins, not a translate: Tailwind's transform utilities need base variables this build does not load.
  sheet: "bottom-0 left-0 right-0 mx-auto max-h-[78vh] w-[760px] max-w-full rounded-t-card border border-b-0",
  side: "right-0 top-0 h-screen w-[400px] max-w-full border-l",
};

/** The one PredictX panel on X: AI tip, Swap quote and Predict (create a pool), in a popup, a slide-up sheet or a side panel. */
export function Panel({ tokens, tab, symbol, mode, onTab, onSymbol, onMode, onMinimise, onClose }: {
  tokens: Token[];
  tab: PanelTab;
  symbol: string;
  mode: PanelMode;
  onTab(tab: PanelTab): void;
  onSymbol(symbol: string): void;
  onMode(mode: PanelMode): void;
  onMinimise(): void;
  onClose(): void;
}) {
  // One suggested limit per symbol: a tip for ETH must never prefill the BTC order. The nonce lets the same price re-apply.
  const [limits, setLimits] = useState<Record<string, { price: string; nonce: number }>>({});
  const applyLimit = (price: string, suggestion: LimitSuggestion): void => {
    setLimits((prev) => ({ ...prev, [suggestion.symbol]: { price, nonce: (prev[suggestion.symbol]?.nonce ?? 0) + 1 } }));
    onSymbol(suggestion.symbol);
    onTab("swap");
  };
  const token = tokens.find((t) => t.symbol === symbol) ?? tokens[0];
  const firstSwappable = tokens.find((t) => t.flashSupported)?.symbol;

  // Flash trades only some tokens: landing on Swap with another one moves to the first it can trade.
  useEffect(() => {
    if (tab === "swap" && token && !token.flashSupported && firstSwappable) onSymbol(firstSwappable);
  }, [tab, token, firstSwappable, onSymbol]);

  if (!token) return null;
  const pickMode = (next: PanelMode): void => {
    saveMode(next);
    onMode(next);
  };

  return (
    <section
      aria-label="PredictX"
      className={cx(
        "px-card-in pointer-events-auto fixed flex flex-col overflow-hidden border-rule bg-ink text-text shadow-card",
        FRAME[mode],
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <span className="font-display text-16 font-bold">Predict<span className="text-amber">X</span></span>
        <div className="flex items-center gap-1">
          <div role="group" aria-label="Display mode" className="flex gap-0.5 rounded-button bg-ink2 p-0.5">
            {MODE_BUTTONS.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-label={m.label}
                aria-pressed={mode === m.mode}
                title={m.label}
                onClick={() => pickMode(m.mode)}
                className={cx(
                  "flex h-7 w-8 items-center justify-center rounded-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber",
                  mode === m.mode ? "bg-ink text-amber shadow-card" : "text-mute hover:text-text",
                )}
              >
                {m.icon}
              </button>
            ))}
          </div>
          <IconButton label="Minimise" onClick={onMinimise}><svg {...ICON}><path d="M3 8h10" /></svg></IconButton>
          <IconButton label="Close" onClick={onClose}><svg {...ICON}><path d="M4 4l8 8M12 4l-8 8" /></svg></IconButton>
        </div>
      </header>

      <Tabs<PanelTab> tabs={TABS} value={tab} onChange={onTab} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3">
          {tab === "ai" ? (
            <>
              <TokenPicker tokens={tokens} symbol={token.symbol} onChange={onSymbol} />
              <InsightPanel key={token.symbol} symbol={token.symbol} canTrade={token.flashSupported} onUseLimit={applyLimit} />
            </>
          ) : null}
          {tab === "swap" ? (
            <>
              <TokenPicker tokens={tokens} symbol={token.symbol} onChange={onSymbol} only={(t) => t.flashSupported} />
              <SwapPanel key={token.symbol} token={token} initialLimit={limits[token.symbol]?.price ?? null} limitNonce={limits[token.symbol]?.nonce ?? 0} />
            </>
          ) : null}
          {tab === "predict" ? <CreatePrediction key={token.symbol} tokens={tokens} initialSymbol={token.symbol} onDone={onClose} /> : null}
        </div>
      </div>
    </section>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-input text-mute hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
    >
      {children}
    </button>
  );
}
