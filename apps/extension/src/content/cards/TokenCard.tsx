import type { Token } from "@predictx/shared";
import { TokenMarketCard } from "@predictx/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnchorRect, HoverStore } from "../../x/hoverStore";
import { CARD_MARGIN_PX, placeCard } from "../../x/hoverStore";

/** Measured from the design: header 48, price block, 108 px chart, buttons row and 24 px padding. */
export const CARD_WIDTH = 480;
/** First-paint guess only; the rendered height is measured after mount and the card is placed again. */
export const CARD_HEIGHT_ESTIMATE = 454;
const VIEWPORT_GUTTER_PX = 24;

/** Only a scroll of the page itself dismisses the card; scrolling inside the card or any other box must not. */
export function isViewportScroll(event: Event, card: Element | null): boolean {
  const target = event.target;
  if (card && target instanceof Node && card.contains(target)) return false;
  return target === document || target === document.scrollingElement;
}

export interface TokenCardProps {
  token: Token;
  anchor: AnchorRect;
  store: HoverStore;
  onSwap(symbol: string): void;
  onDetails(symbol: string): void;
  onPredict(symbol: string): void;
}

/** A1: the hover card. Positions the market card at the tag; all content and data live in TokenMarketCard. */
export function TokenCard({ token, anchor, store, onSwap, onDetails, onPredict }: TokenCardProps) {
  // The card is fixed to the viewport, so a scroll or resize would leave it floating away from its tag.
  const ref = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  useEffect(() => {
    const dismiss = (): void => store.close();
    const onScroll = (event: Event): void => {
      if (isViewportScroll(event, ref.current)) dismiss();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", dismiss);
    };
  }, [store, anchor]);

  // The estimate is only right for the common content; measure the real card and re-place it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setMeasured(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_GUTTER_PX);
  const maxHeight = Math.max(0, window.innerHeight - 2 * CARD_MARGIN_PX);
  const height = Math.min(measured && measured > 0 ? measured : CARD_HEIGHT_ESTIMATE, maxHeight);
  const place = placeCard(anchor, { width: window.innerWidth, height: window.innerHeight }, { width, height });

  return (
    <section
      ref={ref}
      role="dialog"
      aria-label={`${token.name} ${token.symbol}`}
      onMouseEnter={store.enterCard}
      onMouseLeave={store.leaveCard}
      style={{ left: place.left, top: place.top, width, maxHeight }}
      className="px-card-in pointer-events-auto fixed overflow-y-auto shadow-card"
    >
      <TokenMarketCard
        token={token}
        onClose={store.close}
        onSwap={() => onSwap(token.symbol)}
        onDetails={() => onDetails(token.symbol)}
        onPredict={() => onPredict(token.symbol)}
      />
    </section>
  );
}
