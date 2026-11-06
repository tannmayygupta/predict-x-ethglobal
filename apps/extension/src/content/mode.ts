export type PanelMode = "popup" | "sheet" | "side";

const KEY = "predictx:panel-mode";
const MODES: readonly PanelMode[] = ["popup", "sheet", "side"];

/** The viewer's last display choice. Storage can be blocked by the page or the browser, so every access is guarded. */
export function loadMode(): PanelMode {
  try {
    const saved = window.localStorage.getItem(KEY);
    return MODES.find((m) => m === saved) ?? "popup";
  } catch {
    return "popup";
  }
}

export function saveMode(mode: PanelMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* a blocked store only means the choice is not remembered */
  }
}
