export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HoverState {
  symbol: string | null;
  anchor: AnchorRect | null;
}

/** UI_REFERENCE section 6: open after 300 ms on the tag, close 150 ms after leaving both tag and card. */
export const OPEN_DELAY_MS = 300;
export const CLOSE_DELAY_MS = 150;

const CLOSED: HoverState = { symbol: null, anchor: null };

export interface HoverStore {
  getState(): HoverState;
  subscribe(listener: () => void): () => void;
  enterTag(symbol: string, anchor: AnchorRect): void;
  leaveTag(): void;
  enterCard(): void;
  leaveCard(): void;
  close(): void;
}

/** One card at a time: entering a different tag replaces the open card when its delay elapses. */
export function createHoverStore(): HoverStore {
  let state: HoverState = CLOSED;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: HoverState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancelOpen = (): void => clearTimeout(openTimer);
  const cancelClose = (): void => clearTimeout(closeTimer);
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer = setTimeout(() => set(CLOSED), CLOSE_DELAY_MS);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enterTag(symbol, anchor) {
      cancelClose();
      if (state.symbol === symbol) {
        cancelOpen();
        return;
      }
      cancelOpen();
      openTimer = setTimeout(() => set({ symbol, anchor }), OPEN_DELAY_MS);
    },
    leaveTag() {
      cancelOpen();
      if (state.symbol !== null) scheduleClose();
    },
    enterCard: cancelClose,
    leaveCard() {
      scheduleClose();
    },
    close() {
      cancelOpen();
      cancelClose();
      set(CLOSED);
    },
  };
}

export interface Placement {
  left: number;
  top: number;
}

const GAP_PX = 8;
const MARGIN_PX = 12;

/** Below the tag with an 8 px gap; above it when there is less than the card's height below; clamped to the viewport. */
export function placeCard(anchor: AnchorRect, viewport: { width: number; height: number }, card: { width: number; height: number }): Placement {
  const below = anchor.bottom + GAP_PX;
  const fitsBelow = viewport.height - anchor.bottom - GAP_PX >= card.height;
  const top = fitsBelow ? below : Math.max(MARGIN_PX, anchor.top - GAP_PX - card.height);
  const left = Math.min(Math.max(MARGIN_PX, anchor.left), viewport.width - card.width - MARGIN_PX);
  return { left: Math.max(MARGIN_PX, left), top };
}
